import { Logger } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ExtractorService } from '@modules/overlay-metrics-etl/extractor/extractor.service';
import { TrackingEsService } from '@modules/overlay-metrics-etl/extractor/elasticsearch/tracking-es.service';
import type {
  DeviceBreakdownAggs,
  FailureAggs,
  LatencyAggs,
  PlatformMetricsAggs,
  SdkVersionAggs,
  TimeseriesAggs,
  TransportComparisonAggs,
} from '@modules/overlay-metrics-etl/extractor/elasticsearch/types/tracking-es-aggs.types';
import { LoaderService } from '@modules/overlay-metrics-etl/loader/loader.service';
import { TimelineProcessorService } from '@modules/overlay-metrics-etl/kafka/timeline-processor.service';
import { TransformerService } from '@modules/overlay-metrics-etl/transformer/transformer.service';
import type { TransformContext } from '@modules/overlay-metrics-etl/interfaces/transform-context.interface';

type TrackingEsMock = Record<
  | 'queryPlatformMetrics'
  | 'queryDeviceBreakdown'
  | 'queryTransportComparison'
  | 'querySdkVersions'
  | 'queryFailures'
  | 'queryLatency'
  | 'queryTimeseries',
  jest.Mock
>;

type LoaderMock = Record<
  | 'loadPlatformMetrics'
  | 'loadDeviceBreakdown'
  | 'loadTransportComparison'
  | 'loadSdkVersions'
  | 'loadFailures'
  | 'loadLatency'
  | 'loadTimeseries',
  jest.Mock
>;

const intervalFrom = new Date('2026-05-13T10:00:00.000Z');
const intervalTo = new Date('2026-05-13T10:05:00.000Z');
const ctx: TransformContext = {
  timelineId: 'timeline-partial-001',
  matchId: 'match-partial-001',
  tenantId: 'tenant-001',
  intervalFrom,
  intervalTo,
};
const expectedQuery = {
  timelineIds: [ctx.timelineId],
  tenantId: ctx.tenantId,
  from: intervalFrom,
  to: intervalTo,
};

const platformAggs = {
  platforms: {
    buckets: [
      {
        key: 'web',
        received: { doc_count: 120 },
        rendered: { doc_count: 100, avg_render_ms: { value: Number.NaN } },
        failed: { doc_count: 20 },
      },
      {
        key: 'ios',
        sent: { room_size_sum: { value: 200 } },
        received: { doc_count: 180 },
        rendered: { doc_count: 150, avg_render_ms: { value: null } },
        failed: { doc_count: 5 },
      },
    ],
  },
} as unknown as PlatformMetricsAggs;

const deviceAggsByDimension: Record<string, DeviceBreakdownAggs> = {
  browser: {
    by_dimension: {
      buckets: [
        { key: 'Chrome' } as unknown as NonNullable<DeviceBreakdownAggs['by_dimension']>['buckets'][number],
        {
          key: 'Safari',
          by_stage: {
            buckets: {
              received: { doc_count: 40 },
              rendered: {
                doc_count: 30,
                avg_render_ms: { value: 45.678 },
              },
              failed: { doc_count: 10 },
            },
          },
        },
      ],
    },
  },
  os: {
    by_dimension: {
      buckets: [
        {
          key: 'iOS',
          by_stage: {
            buckets: {
              received: { doc_count: 30 },
              rendered: { doc_count: 24, avg_render_ms: { value: 70 } },
              failed: { doc_count: 6 },
            },
          },
        },
      ],
    },
  },
  deviceClass: {
    by_dimension: {
      buckets: [
        {
          key: 'mobile',
          by_stage: {
            buckets: {
              received: { doc_count: 50 },
              rendered: { doc_count: 45, avg_render_ms: { value: 33.333 } },
              failed: { doc_count: 5 },
            },
          },
        },
      ],
    },
  },
};

const transportAggs = {
  by_transport: {
    buckets: [
      {
        key: 'webrtc',
        doc_count: 90,
        by_stage: {
          buckets: {
            received: { doc_count: 60 },
            rendered: {
              doc_count: 54,
              avg_render_ms: { value: 88.888 },
              p95_render_ms: { values: undefined },
            },
          },
        },
      },
      {
        key: 'http',
        doc_count: 10,
        by_stage: {
          buckets: {
            received: { doc_count: 10 },
            rendered: {
              doc_count: 0,
              avg_render_ms: { value: null },
              p95_render_ms: { values: { '95.0': null } },
            },
          },
        },
      },
    ],
  },
} as unknown as TransportComparisonAggs;

const sdkAggs = {
  by_sdk_version: {
    buckets: [
      {
        key: '2.1.0',
        doc_count: 20,
        by_stage: {
          buckets: {
            received: { doc_count: 20 },
            rendered: { doc_count: 18, avg_render_ms: { value: 24.499 } },
          },
        },
      },
    ],
  },
} as unknown as SdkVersionAggs;

const failureAggs = {
  by_reason: {
    buckets: [
      { key: 'timeout', doc_count: 4, by_step: { buckets: [] } },
      {
        key: 'network',
        doc_count: 2,
        by_step: { buckets: [{ key: 'render', doc_count: 2 }] },
      },
    ],
  },
} as unknown as FailureAggs;

const latencyAggs = {
  receive_latency: {
    values: {
      '50.0': 12.345,
      '75.0': 20,
      '95.0': null,
      '99.0': Number.NaN,
    },
  },
  render_latency: {
    values: {
      '50.0': 45,
      '75.0': 55,
      '95.0': 75.555,
      '99.0': 110,
    },
  },
  render_stats: {
    avg: Number.NaN,
    max: 120,
  },
  ack_latency: {
    values: {
      '50.0': 1,
      '75.0': 2,
      '95.0': 3,
      '99.0': 4,
    },
  },
  ack_stats: {
    avg: 2.345,
    max: 7.891,
  },
  render_duration: {
    values: {
      '50.0': 44.444,
      '95.0': 88.888,
      '99.0': 120.001,
    },
  },
  render_duration_stats: {
    avg: null,
  },
} as unknown as LatencyAggs;

const timeseriesAggsByMetric: Record<string, TimeseriesAggs> = {
  sent: {
    timeseries: {
      buckets: [
        {
          key: Date.parse('2026-05-13T10:00:00.000Z'),
          key_as_string: '2026-05-13T10:00:00.000Z',
          metric_value: { value: 100 },
        },
        {
          key: Date.parse('2026-05-13T10:05:00.000Z'),
          key_as_string: '2026-05-13T10:05:00.000Z',
        } as unknown as NonNullable<TimeseriesAggs['timeseries']>['buckets'][number],
      ],
    },
  },
  received: {
    timeseries: {
      buckets: [
        {
          key: Date.parse('2026-05-13T10:00:00.000Z'),
          key_as_string: '2026-05-13T10:00:00.000Z',
          metric_value: { doc_count: 80 },
        },
      ],
    },
  },
  rendered: {
    timeseries: {
      buckets: [
        {
          key: Date.parse('2026-05-13T10:00:00.000Z'),
          key_as_string: '2026-05-13T10:00:00.000Z',
          metric_value: { doc_count: Number.NaN },
        },
      ],
    },
  },
  failed: {
    timeseries: {
      buckets: [
        {
          key: Date.parse('2026-05-13T10:00:00.000Z'),
          key_as_string: '2026-05-13T10:00:00.000Z',
          metric_value: { doc_count: 2 },
        },
      ],
    },
  },
  avgRenderMs: {
    timeseries: {
      buckets: [
        {
          key: Date.parse('2026-05-13T10:00:00.000Z'),
          key_as_string: '2026-05-13T10:00:00.000Z',
          metric_value: { value: null },
        },
      ],
    },
  },
};

const aggResult = <TAggs>(aggregations: TAggs) => ({ aggregations, took: 7 });

describe('UC-10 - ES partial data nhưng ETL vẫn hoàn thành', () => {
  it('chuẩn hóa NaN, null, undefined về 0 khi transform partial aggregations từ nhiều metrics', async () => {
    // Nghiệp vụ: partial data từ Elasticsearch không được làm sai số liệu, mọi giá trị NaN/null/undefined phải rơi về 0 an toàn.
    const moduleRef = await Test.createTestingModule({
      providers: [TransformerService],
    }).compile();
    const transformer = moduleRef.get(TransformerService);

    const platform = transformer.transformPlatformMetrics(platformAggs, ctx);
    expect(platform).toEqual([
      expect.objectContaining({
        platform: 'web',
        sent: 0,
        received: 120,
        rendered: 100,
        failed: 20,
        receiveRate: 0,
        renderRate: 83.33,
        failureRate: 16.67,
        netSuccessRate: 0,
        avgRenderMs: 0,
      }),
      expect.objectContaining({
        platform: 'ios',
        sent: 200,
        received: 180,
        rendered: 150,
        failed: 5,
        avgRenderMs: 0,
      }),
    ]);

    const browser = transformer.transformDeviceBreakdown(
      deviceAggsByDimension.browser,
      ctx,
      'browser',
    );
    expect(browser).toEqual([
      expect.objectContaining({
        dimension: 'browser',
        bucketKey: 'Chrome',
        received: 0,
        rendered: 0,
        failed: 0,
        renderRate: 0,
        avgRenderMs: 0,
      }),
      expect.objectContaining({
        dimension: 'browser',
        bucketKey: 'Safari',
        received: 40,
        rendered: 30,
        failed: 10,
        renderRate: 75,
        avgRenderMs: 45.68,
      }),
    ]);

    const transport = transformer.transformTransportComparison(
      transportAggs,
      ctx,
    );
    expect(transport).toEqual([
      expect.objectContaining({
        transportMode: 'webrtc',
        count: 90,
        renderRate: 90,
        avgRenderMs: 88.89,
        p95RenderMs: 0,
      }),
      expect.objectContaining({
        transportMode: 'http',
        count: 10,
        renderRate: 0,
        avgRenderMs: 0,
        p95RenderMs: 0,
      }),
    ]);

    const failures = transformer.transformFailures(failureAggs, ctx);
    expect(failures).toEqual([
      expect.objectContaining({
        failureReason: 'network',
        failureStep: 'render',
        count: 2,
        percentOfFailed: 100,
      }),
    ]);

    const latency = transformer.transformLatency(latencyAggs, ctx);
    expect(latency.receive).toEqual({
      p50: 12.35,
      p75: 20,
      p95: 0,
      p99: 0,
      avg: 0,
      max: 0,
    });
    expect(latency.render).toEqual({
      p50: 45,
      p75: 55,
      p95: 75.56,
      p99: 110,
      avg: 0,
      max: 120,
    });
    expect(latency.ack).toEqual({
      p50: 1,
      p75: 2,
      p95: 3,
      p99: 4,
      avg: 2.35,
      max: 7.89,
    });
    expect(latency.renderDuration).toEqual({
      p50: 44.44,
      p95: 88.89,
      p99: 120,
      avg: 0,
    });

    const sentTimeseries = transformer.transformTimeseries(
      timeseriesAggsByMetric.sent,
      ctx,
      'sent',
      '5m',
    );
    expect(sentTimeseries).toEqual([
      expect.objectContaining({ metric: 'sent', value: 100 }),
      expect.objectContaining({ metric: 'sent', value: 0 }),
    ]);

    const renderedTimeseries = transformer.transformTimeseries(
      timeseriesAggsByMetric.rendered,
      ctx,
      'rendered',
      '5m',
    );
    expect(renderedTimeseries).toEqual([
      expect.objectContaining({ metric: 'rendered', value: 0 }),
    ]);

    const avgRenderMsTimeseries = transformer.transformTimeseries(
      timeseriesAggsByMetric.avgRenderMs,
      ctx,
      'avgRenderMs',
      '5m',
    );
    expect(avgRenderMsTimeseries).toEqual([
      expect.objectContaining({ metric: 'avgRenderMs', value: 0 }),
    ]);

    await moduleRef.close();
  });

  it('processor không crash, vẫn chạy đủ 7 bước và load dữ liệu đã normalize khi ES trả partial data cho nhiều query', async () => {
    // Nghiệp vụ: dù một số aggregation con bị thiếu hoặc rỗng, processor vẫn phải xử lý hết pipeline và upsert được dữ liệu còn dùng được.
    const trackingEsMock: TrackingEsMock = {
      queryPlatformMetrics: jest.fn().mockResolvedValue(aggResult(platformAggs)),
      queryDeviceBreakdown: jest
        .fn()
        .mockImplementation(
          async (_query: unknown, dimension: string) =>
            aggResult(deviceAggsByDimension[dimension]),
        ),
      queryTransportComparison: jest
        .fn()
        .mockResolvedValue(aggResult(transportAggs)),
      querySdkVersions: jest.fn().mockResolvedValue(aggResult(sdkAggs)),
      queryFailures: jest.fn().mockResolvedValue(aggResult(failureAggs)),
      queryLatency: jest.fn().mockResolvedValue(aggResult(latencyAggs)),
      queryTimeseries: jest
        .fn()
        .mockImplementation(
          async (_query: unknown, metric: string) =>
            aggResult(timeseriesAggsByMetric[metric]),
        ),
    };
    const loaderMock: LoaderMock = {
      loadPlatformMetrics: jest.fn().mockResolvedValue(undefined),
      loadDeviceBreakdown: jest.fn().mockResolvedValue(undefined),
      loadTransportComparison: jest.fn().mockResolvedValue(undefined),
      loadSdkVersions: jest.fn().mockResolvedValue(undefined),
      loadFailures: jest.fn().mockResolvedValue(undefined),
      loadLatency: jest.fn().mockResolvedValue(undefined),
      loadTimeseries: jest.fn().mockResolvedValue(undefined),
    };
    const errorSpy = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        TimelineProcessorService,
        ExtractorService,
        TransformerService,
        { provide: TrackingEsService, useValue: trackingEsMock },
        { provide: LoaderService, useValue: loaderMock },
      ],
    }).compile();
    const timelineProcessor = moduleRef.get(TimelineProcessorService);

    const payload = {
      tenantId: ctx.tenantId,
      matchId: ctx.matchId,
      timelineId: ctx.timelineId,
      timeRangeMinutes: 5,
      intervalFrom: intervalFrom.toISOString(),
      intervalTo: intervalTo.toISOString(),
    };

    await expect(timelineProcessor.processTimeline(payload)).resolves.toBeUndefined();

    expect(errorSpy).not.toHaveBeenCalled();

    expect(trackingEsMock.queryPlatformMetrics).toHaveBeenCalledWith(
      expectedQuery,
    );
    expect(trackingEsMock.queryDeviceBreakdown).toHaveBeenCalledTimes(3);
    expect(trackingEsMock.queryDeviceBreakdown).toHaveBeenNthCalledWith(
      1,
      expectedQuery,
      'browser',
    );
    expect(trackingEsMock.queryDeviceBreakdown).toHaveBeenNthCalledWith(
      2,
      expectedQuery,
      'os',
    );
    expect(trackingEsMock.queryDeviceBreakdown).toHaveBeenNthCalledWith(
      3,
      expectedQuery,
      'deviceClass',
    );
    expect(trackingEsMock.queryTransportComparison).toHaveBeenCalledWith(
      expectedQuery,
    );
    expect(trackingEsMock.querySdkVersions).toHaveBeenCalledWith(expectedQuery);
    expect(trackingEsMock.queryFailures).toHaveBeenCalledWith(expectedQuery);
    expect(trackingEsMock.queryLatency).toHaveBeenCalledWith(expectedQuery);
    expect(trackingEsMock.queryTimeseries).toHaveBeenCalledTimes(5);
    expect(trackingEsMock.queryTimeseries).toHaveBeenNthCalledWith(
      1,
      expectedQuery,
      'sent',
      '5m',
    );
    expect(trackingEsMock.queryTimeseries).toHaveBeenNthCalledWith(
      5,
      expectedQuery,
      'avgRenderMs',
      '5m',
    );

    expect(loaderMock.loadPlatformMetrics).toHaveBeenCalledWith(ctx.tenantId, [
      expect.objectContaining({ platform: 'web', sent: 0, avgRenderMs: 0 }),
      expect.objectContaining({ platform: 'ios', avgRenderMs: 0 }),
    ]);

    expect(loaderMock.loadDeviceBreakdown).toHaveBeenCalledTimes(3);
    expect(loaderMock.loadDeviceBreakdown).toHaveBeenNthCalledWith(1, ctx.tenantId, [
      expect.objectContaining({
        dimension: 'browser',
        bucketKey: 'Chrome',
        received: 0,
        rendered: 0,
        failed: 0,
        avgRenderMs: 0,
      }),
      expect.objectContaining({
        dimension: 'browser',
        bucketKey: 'Safari',
        avgRenderMs: 45.68,
      }),
    ]);

    expect(loaderMock.loadTransportComparison).toHaveBeenCalledWith(ctx.tenantId, [
      expect.objectContaining({ transportMode: 'webrtc', p95RenderMs: 0 }),
      expect.objectContaining({ transportMode: 'http', avgRenderMs: 0, p95RenderMs: 0 }),
    ]);
    expect(loaderMock.loadSdkVersions).toHaveBeenCalledWith(ctx.tenantId, [
      expect.objectContaining({ sdkVersion: '2.1.0', count: 20, avgRenderMs: 24.5 }),
    ]);
    expect(loaderMock.loadFailures).toHaveBeenCalledWith(ctx.tenantId, [
      expect.objectContaining({
        failureReason: 'network',
        failureStep: 'render',
        count: 2,
        percentOfFailed: 100,
      }),
    ]);
    expect(loaderMock.loadLatency).toHaveBeenCalledWith(ctx.tenantId, [
      expect.objectContaining({
        receive: expect.objectContaining({ avg: 0, max: 0, p95: 0, p99: 0 }),
        render: expect.objectContaining({ avg: 0, max: 120 }),
        renderDuration: expect.objectContaining({ avg: 0 }),
      }),
    ]);
    expect(loaderMock.loadTimeseries).toHaveBeenCalledTimes(5);
    expect(loaderMock.loadTimeseries).toHaveBeenNthCalledWith(1, ctx.tenantId, [
      expect.objectContaining({ metric: 'sent', value: 100 }),
      expect.objectContaining({ metric: 'sent', value: 0 }),
    ]);
    expect(loaderMock.loadTimeseries).toHaveBeenNthCalledWith(3, ctx.tenantId, [
      expect.objectContaining({ metric: 'rendered', value: 0 }),
    ]);
    expect(loaderMock.loadTimeseries).toHaveBeenNthCalledWith(5, ctx.tenantId, [
      expect.objectContaining({ metric: 'avgRenderMs', value: 0 }),
    ]);

    await moduleRef.close();
    errorSpy.mockRestore();
  });
});
