import { ConfigService } from '@nestjs/config';
import { ElasticsearchService } from '@nestjs/elasticsearch';
import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import { TrackingEsService } from '../../src/modules/overlay-metrics-etl/extractor/elasticsearch/tracking-es.service';
import type {
  TimeseriesAggs,
  TimeseriesMetricValue,
} from '../../src/modules/overlay-metrics-etl/extractor/elasticsearch/types/tracking-es-aggs.types';
import { TimeseriesPointDto } from '../../src/domain/dto/timeseries-point.dto';
import { TransformerService } from '../../src/modules/overlay-metrics-etl/transformer/transformer.service';
import type { TransformContext } from '../../src/modules/overlay-metrics-etl/transformer/transformer.service';

const interval = '5m';
const startTime = new Date('2026-05-13T10:00:00.000Z');

const ctx: TransformContext = {
  timelineId: 'timeline-uc-08',
  matchId: 'match-uc-08',
  tenantId: 'tenant-uc-08',
  intervalFrom: startTime,
  intervalTo: new Date('2026-05-13T10:50:00.000Z'),
};

const makeTimeseriesAggs = (
  metricValueFor: (index: number) => TimeseriesMetricValue,
): TimeseriesAggs => ({
  timeseries: {
    buckets: Array.from({ length: 10 }, (_, index) => {
      const time = new Date(startTime.getTime() + index * 5 * 60 * 1000);

      return {
        key: time.getTime(),
        key_as_string: time.toISOString(),
        doc_count: index + 1,
        metric_value: metricValueFor(index),
      };
    }),
  },
});

type TimeseriesSearchRequest = {
  aggs: {
    timeseries: {
      date_histogram: unknown;
      aggs: {
        metric_value: unknown;
      };
    };
  };
};

describe('UC-08 - Timeseries 5 metrics theo thời gian 5 phút', () => {
  let moduleRef: TestingModule;
  let trackingEsService: TrackingEsService;
  let transformerService: TransformerService;
  let esSearchMock: jest.Mock;

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
            get: jest.fn((key: string, defaultValue?: unknown): unknown => {
              const values: Record<string, unknown> = {
                'elasticsearch.trackingIndex': 'tracking-events-test',
                'elasticsearch.trackingTimeoutMs': 12345,
                'app.elasticApmEnvironment': 'test',
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

  it('mock ES date_histogram 10 buckets và map đúng 5 metrics/stages sang TimeseriesPointDto', async () => {
    const metricCases: Array<{
      metric: string;
      expectedAgg: Record<string, unknown>;
      metricValueFor: (index: number) => TimeseriesMetricValue;
      expectedFirstValue: number;
      expectedLastValue: number;
    }> = [
      {
        metric: 'sent',
        expectedAgg: { sum: { field: 'numeric_labels.room_size' } },
        metricValueFor: (index: number) => ({ value: (index + 1) * 100 }),
        expectedFirstValue: 100,
        expectedLastValue: 1000,
      },
      {
        metric: 'received',
        expectedAgg: { filter: { term: { 'labels.stage': 'received' } } },
        metricValueFor: (index: number) => ({ doc_count: index + 10 }),
        expectedFirstValue: 10,
        expectedLastValue: 19,
      },
      {
        metric: 'rendered',
        expectedAgg: { filter: { term: { 'labels.stage': 'rendered' } } },
        metricValueFor: (index: number) => ({ doc_count: index + 20 }),
        expectedFirstValue: 20,
        expectedLastValue: 29,
      },
      {
        metric: 'failed',
        expectedAgg: { filter: { term: { 'labels.stage': 'render-failed' } } },
        metricValueFor: (index: number) => ({ doc_count: index }),
        expectedFirstValue: 0,
        expectedLastValue: 9,
      },
      {
        metric: 'avgRenderMs',
        expectedAgg: { avg: { field: 'numeric_labels.render_duration_ms' } },
        metricValueFor: (index: number) => ({ value: 30.123 + index }),
        expectedFirstValue: 30.12,
        expectedLastValue: 39.12,
      },
    ];

    for (const metricCase of metricCases) {
      const aggregations = makeTimeseriesAggs(metricCase.metricValueFor);
      esSearchMock.mockResolvedValueOnce({ aggregations, took: 5 });

      const result = await trackingEsService.queryTimeseries(
        {
          tenantId: ctx.tenantId,
          timelineIds: [ctx.timelineId],
          from: ctx.intervalFrom,
          to: ctx.intervalTo,
        },
        metricCase.metric,
        interval,
      );

      const lastCall = esSearchMock.mock.calls[
        esSearchMock.mock.calls.length - 1
      ] as [TimeseriesSearchRequest, Record<string, unknown>];
      const [searchRequest, searchOptions] = lastCall;

      expect(searchOptions).toEqual({ requestTimeout: 12345 });
      expect(searchRequest.aggs.timeseries.date_histogram).toEqual({
        field: '@timestamp',
        fixed_interval: interval,
      });
      expect(searchRequest.aggs.timeseries.aggs.metric_value).toEqual(
        metricCase.expectedAgg,
      );

      const points = transformerService.transformTimeseries(
        result.aggregations,
        ctx,
        metricCase.metric,
        interval,
      );
      const firstPoint: TimeseriesPointDto = points[0];

      expect(points).toHaveLength(10);
      expect(firstPoint).toMatchObject({
        timelineId: ctx.timelineId,
        matchId: ctx.matchId,
        tenantId: ctx.tenantId,
        metric: metricCase.metric,
        interval,
        time: startTime,
        value: metricCase.expectedFirstValue,
        intervalFrom: ctx.intervalFrom,
        intervalTo: ctx.intervalTo,
      });
      expect(points[9]).toMatchObject({
        metric: metricCase.metric,
        interval,
        time: new Date('2026-05-13T10:45:00.000Z'),
        value: metricCase.expectedLastValue,
      });
    }
  });

  it('edge case: invalid metric bị reject thay vì fallback sai về sent', async () => {
    await expect(
      trackingEsService.queryTimeseries(
        { tenantId: ctx.tenantId, from: ctx.intervalFrom, to: ctx.intervalTo },
        'invalidMetric',
        interval,
      ),
    ).rejects.toThrow('Unsupported timeseries metric: invalidMetric');

    expect(esSearchMock).not.toHaveBeenCalled();
  });
});
