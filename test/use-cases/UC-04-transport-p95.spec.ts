import { ConfigService } from '@nestjs/config';
import { ElasticsearchService } from '@nestjs/elasticsearch';
import { Test, TestingModule } from '@nestjs/testing';
import { TrackingAggQuery } from '@modules/overlay-metrics-etl/extractor/dto/tracking-agg-query.dto';
import { TrackingEsService } from '@modules/overlay-metrics-etl/extractor/elasticsearch/tracking-es.service';
import { TransportComparisonAggs } from '@modules/overlay-metrics-etl/extractor/elasticsearch/types/tracking-es-aggs.types';
import { TransformerService } from '@modules/overlay-metrics-etl/transformer/transformer.service';
import { TransportComparisonDto } from '@domain/dto/transport-comparison.dto';
import { TransformContext } from '@modules/overlay-metrics-etl/interfaces/transform-context.interface';

describe('UC-04: Phân tích transport mode với p95 render latency', () => {
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

  it('mock ES trả về 3 transport modes và transform p95_render_ms values["95.0"]', async () => {
    const aggregations: TransportComparisonAggs = {
      by_transport: {
        buckets: [
          {
            key: 'websocket',
            doc_count: 228,
            by_stage: {
              buckets: {
                received: { doc_count: 120 },
                rendered: {
                  doc_count: 108,
                  avg_render_ms: { value: 42.456 },
                  p95_render_ms: { values: { '95.0': 80.123 } },
                },
              },
            },
          },
          {
            key: 'webrtc',
            doc_count: 152,
            by_stage: {
              buckets: {
                received: { doc_count: 80 },
                rendered: {
                  doc_count: 72,
                  avg_render_ms: { value: 50 },
                  p95_render_ms: { values: { '95.0': 95.5 } },
                },
              },
            },
          },
          {
            key: 'http',
            doc_count: 80,
            by_stage: {
              buckets: {
                received: { doc_count: 50 },
                rendered: {
                  doc_count: 30,
                  avg_render_ms: { value: 120 },
                  p95_render_ms: { values: { '95.0': 250 } },
                },
              },
            },
          },
        ],
      },
    };

    esSearchMock.mockResolvedValue({ aggregations, took: 7 });

    const esResult = await trackingEsService.queryTransportComparison(query);
    const result: TransportComparisonDto[] =
      transformerService.transformTransportComparison(
        esResult.aggregations,
        ctx,
      );

    expect(esSearchMock).toHaveBeenCalledWith(
      expect.objectContaining({
        index: 'tracking-events-*',
        size: 0,
        aggs: expect.objectContaining({
          by_transport: expect.objectContaining({
            terms: expect.objectContaining({
              field: 'labels.transport_mode',
            }),
          }),
        }),
      }),
      { requestTimeout: 5000 },
    );
    expect(esSearchMock.mock.calls[0][0].aggs.by_transport.aggs.by_stage.aggs)
      .toMatchObject({
        avg_render_ms: { avg: { field: 'numeric_labels.render_duration_ms' } },
        p95_render_ms: {
          percentiles: {
            field: 'numeric_labels.render_duration_ms',
            percents: [95],
          },
        },
      });

    expect(result).toHaveLength(3);
    expect(result).toEqual([
      expect.objectContaining({
        timelineId: 'timeline-live-01',
        matchId: 'match-2026-05-13',
        tenantId: 'tenant-vtv',
        transportMode: 'websocket',
        count: 228,
        renderRate: 90,
        avgRenderMs: 42.46,
        p95RenderMs: 80.12,
        intervalFrom: ctx.intervalFrom,
        intervalTo: ctx.intervalTo,
      }),
      expect.objectContaining({
        transportMode: 'webrtc',
        count: 152,
        renderRate: 90,
        avgRenderMs: 50,
        p95RenderMs: 95.5,
      }),
      expect.objectContaining({
        transportMode: 'http',
        count: 80,
        renderRate: 60,
        avgRenderMs: 120,
        p95RenderMs: 250,
      }),
    ]);
  });

  it('edge case: thiếu p95 values thì p95RenderMs=0 và count không bị overflow 32-bit', () => {
    const aggregations: TransportComparisonAggs = {
      by_transport: {
        buckets: [
          {
            key: 'http',
            by_stage: {
              buckets: {
                received: { doc_count: 3_000_000_000 },
                rendered: {
                  doc_count: 1_500_000_000,
                  avg_render_ms: { value: null },
                },
              },
            },
          },
        ],
      },
    };

    const result = transformerService.transformTransportComparison(
      aggregations,
      ctx,
    );

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      transportMode: 'http',
      count: 4_500_000_000,
      renderRate: 50,
      avgRenderMs: 0,
      p95RenderMs: 0,
    });
    expect(Number.isFinite(result[0].count)).toBe(true);
  });
});
