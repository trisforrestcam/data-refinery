import { ConfigService } from '@nestjs/config';
import { ElasticsearchService } from '@nestjs/elasticsearch';
import { Test, TestingModule } from '@nestjs/testing';
import { TrackingAggQuery } from '@modules/overlay-metrics-etl/extractor/dto/tracking-agg-query.dto';
import { TrackingEsService } from '@modules/overlay-metrics-etl/extractor/elasticsearch/tracking-es.service';
import type { PlatformMetricsAggs } from '@modules/overlay-metrics-etl/extractor/elasticsearch/types/tracking-es-aggs.types';
import { LoaderService } from '@modules/overlay-metrics-etl/loader/loader.service';
import type { PlatformMetricDto } from '@domain/dto/platform-metric.dto';
import { MetricType } from '@domain/enums/metric-type.enum';
import {
  TransformerService,
  type TransformContext,
} from '@modules/overlay-metrics-etl/transformer/transformer.service';

type EsSearchResult = {
  aggregations: PlatformMetricsAggs;
  took: number;
};

type EsSearchRequest = {
  index?: unknown;
  size?: unknown;
  query?: {
    bool?: {
      must?: Array<Record<string, unknown>>;
    };
  };
  aggs?: {
    platforms?: {
      terms?: {
        field?: unknown;
        size?: unknown;
        missing?: unknown;
      };
      aggs?: Record<string, unknown>;
    };
  };
};

describe('UC-02: Platform metrics cho một trận đấu', () => {
  let trackingEsService: TrackingEsService;
  let transformerService: TransformerService;
  let loaderService: Pick<LoaderService, 'load'>;
  let esSearchMock: jest.Mock<
    Promise<EsSearchResult>,
    [EsSearchRequest, object]
  >;
  let loadMock: jest.Mock<
    Promise<void>,
    [string, MetricType, PlatformMetricDto[]]
  >;

  const intervalFrom = new Date('2026-05-13T10:00:00.000Z');
  const intervalTo = new Date('2026-05-13T10:05:00.000Z');

  const query: TrackingAggQuery = {
    tenantId: 'tenant-vtv',
    timelineIds: ['timeline-match-001'],
    mediaContentId: 'match-001',
    from: intervalFrom,
    to: intervalTo,
  };

  const ctx: TransformContext = {
    tenantId: 'tenant-vtv',
    timelineId: 'timeline-match-001',
    matchId: 'match-001',
    intervalFrom,
    intervalTo,
  };

  beforeEach(async () => {
    esSearchMock = jest.fn();
    loadMock = jest.fn().mockResolvedValue(undefined);

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        TrackingEsService,
        TransformerService,
        {
          provide: ElasticsearchService,
          useValue: {
            search: esSearchMock,
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, defaultValue?: unknown) => {
              const values: Record<string, unknown> = {
                'elasticsearch.trackingIndex': 'tracking-events-*',
                'elasticsearch.trackingTimeoutMs': 10000,
                'app.elasticApmEnvironment': 'production',
              };

              return key in values ? values[key] : defaultValue;
            }),
          },
        },
        {
          provide: LoaderService,
          useValue: {
            load: loadMock,
          },
        },
      ],
    }).compile();

    trackingEsService = moduleRef.get(TrackingEsService);
    transformerService = moduleRef.get(TransformerService);
    loaderService = moduleRef.get(LoaderService);
  });

  // Nghiệp vụ: hệ thống Extract → Transform → Load platform metrics web/ios/android cho một trận đấu.
  it('lấy platform metrics từ Elasticsearch, transform đúng DTO/rates và gọi loader upsert', async () => {
    const aggregations: PlatformMetricsAggs = {
      platforms: {
        buckets: [
          {
            key: 'web',
            sent: { doc_count: 10, room_size_sum: { value: 1000 } },
            received: { doc_count: 950 },
            rendered: { doc_count: 900, avg_render_ms: { value: 120.456 } },
            failed: { doc_count: 50 },
          },
          {
            key: 'ios',
            sent: { doc_count: 8, room_size_sum: { value: 500 } },
            received: { doc_count: 450 },
            rendered: { doc_count: 405, avg_render_ms: { value: 98.1 } },
            failed: { doc_count: 45 },
          },
          {
            key: 'android',
            sent: { doc_count: 5, room_size_sum: { value: 200 } },
            received: { doc_count: 180 },
            rendered: { doc_count: 160, avg_render_ms: { value: 80 } },
            failed: { doc_count: 20 },
          },
        ],
      },
    };
    esSearchMock.mockResolvedValueOnce({ aggregations, took: 12 });

    const extracted = await trackingEsService.queryPlatformMetrics(query);
    const items = transformerService.transformPlatformMetrics(
      extracted.aggregations,
      ctx,
    );
    await loaderService.load(ctx.tenantId, MetricType.PLATFORM, items);

    const expectedItems: PlatformMetricDto[] = [
      {
        tenantId: 'tenant-vtv',
        timelineId: 'timeline-match-001',
        matchId: 'match-001',
        platform: 'web',
        sent: 1000,
        received: 950,
        rendered: 900,
        failed: 50,
        receiveRate: 95,
        renderRate: 94.74,
        failureRate: 5.26,
        netSuccessRate: 90,
        avgRenderMs: 120.46,
        intervalFrom,
        intervalTo,
      },
      {
        tenantId: 'tenant-vtv',
        timelineId: 'timeline-match-001',
        matchId: 'match-001',
        platform: 'ios',
        sent: 500,
        received: 450,
        rendered: 405,
        failed: 45,
        receiveRate: 90,
        renderRate: 90,
        failureRate: 10,
        netSuccessRate: 81,
        avgRenderMs: 98.1,
        intervalFrom,
        intervalTo,
      },
      {
        tenantId: 'tenant-vtv',
        timelineId: 'timeline-match-001',
        matchId: 'match-001',
        platform: 'android',
        sent: 200,
        received: 180,
        rendered: 160,
        failed: 20,
        receiveRate: 90,
        renderRate: 88.89,
        failureRate: 11.11,
        netSuccessRate: 80,
        avgRenderMs: 80,
        intervalFrom,
        intervalTo,
      },
    ];

    expect(items).toEqual(expectedItems);
    expect(loadMock).toHaveBeenCalledTimes(1);
    expect(loadMock).toHaveBeenCalledWith(
      ctx.tenantId,
      MetricType.PLATFORM,
      expectedItems,
    );
  });

  // Nghiệp vụ: query Elasticsearch phải gom theo labels.platform và lọc đúng các stage sent/received/rendered/render-failed.
  it('gửi Elasticsearch query đúng index, terms aggregation platform và stage filters', async () => {
    esSearchMock.mockResolvedValueOnce({
      aggregations: { platforms: { buckets: [] } },
      took: 5,
    });

    await trackingEsService.queryPlatformMetrics(query);

    const [request, options] = esSearchMock.mock.calls[0];

    expect(request.index).toBe('tracking-events-*');
    expect(request.size).toBe(0);
    expect(options).toEqual({ requestTimeout: 10000 });
    expect(request.aggs?.platforms?.terms).toEqual({
      field: 'labels.platform',
      size: 100,
      missing: 'unknown',
    });
    expect(request.aggs?.platforms?.aggs).toMatchObject({
      sent: {
        filter: { term: { 'labels.stage': 'sent' } },
        aggs: {
          room_size_sum: { sum: { field: 'numeric_labels.room_size' } },
        },
      },
      received: { filter: { term: { 'labels.stage': 'received' } } },
      rendered: {
        filter: { term: { 'labels.stage': 'rendered' } },
        aggs: {
          avg_render_ms: {
            avg: { field: 'numeric_labels.render_duration_ms' },
          },
        },
      },
      failed: { filter: { term: { 'labels.stage': 'render-failed' } } },
    });
    expect(request.query?.bool?.must).toEqual(
      expect.arrayContaining([
        { term: { 'labels.tenant_id': 'tenant-vtv' } },
        { term: { 'labels.environment': 'production' } },
        { terms: { 'labels.timeline_id': ['timeline-match-001'] } },
        { term: { 'labels.media_content_id': 'match-001' } },
        {
          range: {
            '@timestamp': {
              gte: intervalFrom.toISOString(),
              lt: intervalTo.toISOString(),
            },
          },
        },
      ]),
    );
  });

  // Nghiệp vụ: sent=0 không được chia cho 0; dữ liệu lệch thờ gian có thể làm received/rendered vượt mốc trước đó; avg NaN phải về 0.
  it('xử lý sent=0, received/rendered vượt mốc trước đó và avgRenderMs=NaN', async () => {
    const aggregations: PlatformMetricsAggs = {
      platforms: {
        buckets: [
          {
            key: 'web',
            sent: { doc_count: 0, room_size_sum: { value: 0 } },
            received: { doc_count: 10 },
            rendered: { doc_count: 11, avg_render_ms: { value: Number.NaN } },
            failed: { doc_count: 2 },
          },
          {
            key: 'ios',
            sent: { doc_count: 1, room_size_sum: { value: 100 } },
            received: { doc_count: 110 },
            rendered: { doc_count: 120, avg_render_ms: { value: Number.NaN } },
            failed: { doc_count: 11 },
          },
        ],
      },
    };
    esSearchMock.mockResolvedValueOnce({ aggregations, took: 7 });

    const extracted = await trackingEsService.queryPlatformMetrics(query);
    const items = transformerService.transformPlatformMetrics(
      extracted.aggregations,
      ctx,
    );
    await loaderService.load(ctx.tenantId, MetricType.PLATFORM, items);

    expect(items[0]).toMatchObject({
      platform: 'web',
      sent: 0,
      received: 10,
      rendered: 11,
      failed: 2,
      receiveRate: 0,
      renderRate: 110,
      failureRate: 20,
      netSuccessRate: 0,
      avgRenderMs: 0,
    });
    expect(items[1]).toMatchObject({
      platform: 'ios',
      sent: 100,
      received: 110,
      rendered: 120,
      failed: 11,
      receiveRate: 110,
      renderRate: 109.09,
      failureRate: 10,
      netSuccessRate: 120,
      avgRenderMs: 0,
    });
    expect(loadMock).toHaveBeenCalledWith(
      ctx.tenantId,
      MetricType.PLATFORM,
      items,
    );
  });

  // Nghiệp vụ: event thiếu labels.platform từ ES phải được gom vào platform unknown và vẫn được load.
  it("xử lý platform='unknown' khi Elasticsearch thiếu labels.platform", async () => {
    const aggregations: PlatformMetricsAggs = {
      platforms: {
        buckets: [
          {
            key: 'unknown',
            sent: { doc_count: 2, room_size_sum: { value: 50 } },
            received: { doc_count: 40 },
            rendered: { doc_count: 35, avg_render_ms: { value: 77 } },
            failed: { doc_count: 5 },
          },
        ],
      },
    };
    esSearchMock.mockResolvedValueOnce({ aggregations, took: 4 });

    const extracted = await trackingEsService.queryPlatformMetrics(query);
    const items = transformerService.transformPlatformMetrics(
      extracted.aggregations,
      ctx,
    );
    await loaderService.load(ctx.tenantId, MetricType.PLATFORM, items);

    expect(items).toEqual([
      {
        tenantId: 'tenant-vtv',
        timelineId: 'timeline-match-001',
        matchId: 'match-001',
        platform: 'unknown',
        sent: 50,
        received: 40,
        rendered: 35,
        failed: 5,
        receiveRate: 80,
        renderRate: 87.5,
        failureRate: 12.5,
        netSuccessRate: 70,
        avgRenderMs: 77,
        intervalFrom,
        intervalTo,
      },
    ]);
    expect(loadMock).toHaveBeenCalledWith(
      ctx.tenantId,
      MetricType.PLATFORM,
      items,
    );
  });
});
