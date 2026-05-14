import { ConfigService } from '@nestjs/config';
import { ElasticsearchService } from '@nestjs/elasticsearch';
import { Test, TestingModule } from '@nestjs/testing';
import { TrackingAggQuery } from '@modules/overlay-metrics-etl/extractor/dto/tracking-agg-query.dto';
import { TrackingEsService } from '@modules/overlay-metrics-etl/extractor/elasticsearch/tracking-es.service';
import { FailureAggs } from '@modules/overlay-metrics-etl/extractor/elasticsearch/types/tracking-es-aggs.types';
import { FailureAnalysisDto } from '@domain/dto/failure-analysis.dto';
import { TransformContext } from '@modules/overlay-metrics-etl/interfaces/transform-context.interface';
import { TransformerService } from '@modules/overlay-metrics-etl/transformer/transformer.service';

describe('UC-06: Phân tích failure theo nested reason → step', () => {
  let moduleRef: TestingModule;
  let trackingEsService: TrackingEsService;
  let transformerService: TransformerService;
  let esSearchMock: jest.Mock;

  const query: TrackingAggQuery = {
    tenantId: 'tenant-vtv',
    timelineIds: ['timeline-live-01'],
    from: new Date('2026-05-13T10:00:00.000Z'),
    to: new Date('2026-05-13T10:05:00.000Z'),
  };

  const ctx: TransformContext = {
    timelineId: 'timeline-live-01',
    matchId: 'match-2026-05-13',
    tenantId: 'tenant-vtv',
    intervalFrom: query.from!,
    intervalTo: query.to!,
  };

  beforeEach(async () => {
    esSearchMock = jest.fn();

    moduleRef = await Test.createTestingModule({
      providers: [
        TrackingEsService,
        TransformerService,
        {
          provide: ElasticsearchService,
          useValue: { search: esSearchMock },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, defaultValue?: unknown) => {
              const values: Record<string, unknown> = {
                'elasticsearch.trackingIndex': 'tracking-events-*',
                'elasticsearch.trackingTimeoutMs': 5000,
                'app.elasticApmEnvironment': 'production',
              };
              return values[key] ?? defaultValue;
            }),
          },
        },
      ],
    }).compile();

    trackingEsService = moduleRef.get(TrackingEsService);
    transformerService = moduleRef.get(TransformerService);
  });

  afterEach(async () => {
    await moduleRef.close();
  });

  it('mock ES trả về 3 failure reasons, mỗi reason 2-3 steps và tính percentOfFailed', async () => {
    const aggregations: FailureAggs = {
      by_reason: {
        buckets: [
          {
            key: 'timeout',
            doc_count: 30,
            by_step: {
              buckets: [
                { key: 'load-overlay', doc_count: 20 },
                { key: 'render-overlay', doc_count: 10 },
              ],
            },
          },
          {
            key: 'network',
            doc_count: 30,
            by_step: {
              buckets: [
                { key: 'connect-transport', doc_count: 15 },
                { key: 'receive-event', doc_count: 10 },
                { key: 'ack-event', doc_count: 5 },
              ],
            },
          },
          {
            key: 'validation',
            doc_count: 10,
            by_step: {
              buckets: [
                { key: 'decode-payload', doc_count: 8 },
                { key: 'schema-check', doc_count: 2 },
              ],
            },
          },
        ],
      },
    };

    esSearchMock.mockResolvedValue({ aggregations, took: 9 });

    const esResult = await trackingEsService.queryFailures(query);
    const result: FailureAnalysisDto[] = transformerService.transformFailures(
      esResult.aggregations,
      ctx,
    );

    expect(esSearchMock).toHaveBeenCalledWith(
      expect.objectContaining({
        index: 'tracking-events-*',
        size: 0,
        aggs: {
          by_reason: {
            terms: { field: 'labels.failure_reason', size: 50 },
            aggs: {
              by_step: {
                terms: { field: 'labels.failure_step', size: 20 },
              },
            },
          },
        },
      }),
      { requestTimeout: 5000 },
    );

    expect(result).toHaveLength(7);
    expect(result).toEqual([
      expect.objectContaining({
        timelineId: 'timeline-live-01',
        matchId: 'match-2026-05-13',
        tenantId: 'tenant-vtv',
        failureReason: 'timeout',
        failureStep: 'load-overlay',
        count: 20,
        percentOfFailed: 28.57,
        intervalFrom: ctx.intervalFrom,
        intervalTo: ctx.intervalTo,
      }),
      expect.objectContaining({
        failureReason: 'timeout',
        failureStep: 'render-overlay',
        count: 10,
        percentOfFailed: 14.29,
      }),
      expect.objectContaining({
        failureReason: 'network',
        failureStep: 'connect-transport',
        count: 15,
        percentOfFailed: 21.43,
      }),
      expect.objectContaining({
        failureReason: 'network',
        failureStep: 'receive-event',
        count: 10,
        percentOfFailed: 14.29,
      }),
      expect.objectContaining({
        failureReason: 'network',
        failureStep: 'ack-event',
        count: 5,
        percentOfFailed: 7.14,
      }),
      expect.objectContaining({
        failureReason: 'validation',
        failureStep: 'decode-payload',
        count: 8,
        percentOfFailed: 11.43,
      }),
      expect.objectContaining({
        failureReason: 'validation',
        failureStep: 'schema-check',
        count: 2,
        percentOfFailed: 2.86,
      }),
    ]);
  });

  it('edge case: totalFailed=0 và NaN doc_count thì percentOfFailed=0', () => {
    const aggregations: FailureAggs = {
      by_reason: {
        buckets: [
          {
            key: 'timeout',
            doc_count: 0,
            by_step: {
              buckets: [
                { key: 'render-overlay', doc_count: 0 },
                { key: 'ack-event', doc_count: Number.NaN },
              ],
            },
          },
          {
            key: 'unknown',
            doc_count: 0,
            by_step: {
              buckets: [{ key: 'unknown', doc_count: 0 }],
            },
          },
        ],
      },
    };

    const result = transformerService.transformFailures(aggregations, ctx);

    expect(result).toHaveLength(3);
    expect(result).toEqual([
      expect.objectContaining({
        failureReason: 'timeout',
        failureStep: 'render-overlay',
        count: 0,
        percentOfFailed: 0,
      }),
      expect.objectContaining({
        failureReason: 'timeout',
        failureStep: 'ack-event',
        count: 0,
        percentOfFailed: 0,
      }),
      expect.objectContaining({
        failureReason: 'unknown',
        failureStep: 'unknown',
        count: 0,
        percentOfFailed: 0,
      }),
    ]);
  });
});
