import { TransformerService } from './transformer.service';
import { TransformContext } from '@common/interfaces/transform-context.interface';

describe('TransformerService', () => {
  let service: TransformerService;

  const ctx: TransformContext = {
    timelineId: 'tl-001',
    matchId: 'match-001',
    tenantId: 'tenant-001',
    intervalFrom: new Date('2024-01-15T10:00:00Z'),
    intervalTo: new Date('2024-01-15T10:05:00Z'),
  };

  beforeEach(() => {
    service = new TransformerService();
  });

  it('should transform platform metrics correctly', () => {
    const aggs = {
      platforms: {
        buckets: [
          {
            key: 'android',
            sent: { room_size_sum: { value: 1000 } },
            received: { doc_count: 950 },
            rendered: { doc_count: 900, avg_render_ms: { value: 120.5 } },
            failed: { doc_count: 50 },
          },
        ],
      },
    };

    const result = service.transformPlatformMetrics(aggs, ctx);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      timelineId: 'tl-001',
      matchId: 'match-001',
      platform: 'android',
      sent: 1000,
      received: 950,
      rendered: 900,
      failed: 50,
      receiveRate: 95,
      renderRate: 94.74,
      failureRate: 5.26,
      netSuccessRate: 90,
      avgRenderMs: 120.5,
    });
  });

  it('should handle zero sent in platform metrics', () => {
    const aggs = {
      platforms: {
        buckets: [
          {
            key: 'web',
            sent: { room_size_sum: { value: 0 } },
            received: { doc_count: 0 },
            rendered: { doc_count: 0, avg_render_ms: { value: 0 } },
            failed: { doc_count: 0 },
          },
        ],
      },
    };

    const result = service.transformPlatformMetrics(aggs, ctx);

    expect(result[0].receiveRate).toBe(0);
    expect(result[0].renderRate).toBe(0);
    expect(result[0].failureRate).toBe(0);
  });

  it('should transform device breakdown correctly', () => {
    const aggs = {
      by_dimension: {
        buckets: [
          {
            key: 'Chrome',
            by_stage: {
              buckets: {
                received: { doc_count: 100 },
                rendered: { doc_count: 80, avg_render_ms: { value: 90 } },
                failed: { doc_count: 5 },
              },
            },
          },
        ],
      },
    };

    const result = service.transformDeviceBreakdown(aggs, ctx, 'browser');

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      dimension: 'browser',
      bucketKey: 'Chrome',
      received: 100,
      rendered: 80,
      failed: 5,
      renderRate: 80,
      avgRenderMs: 90,
    });
  });

  it('should transform transport comparison correctly', () => {
    const aggs = {
      by_transport: {
        buckets: [
          {
            key: 'wsInteractive',
            by_stage: {
              buckets: {
                received: { doc_count: 200 },
                rendered: {
                  doc_count: 180,
                  avg_render_ms: { value: 110 },
                  p95_render_ms: { values: { '95.0': 250 } },
                },
              },
            },
          },
        ],
      },
    };

    const result = service.transformTransportComparison(aggs, ctx);

    expect(result[0]).toMatchObject({
      transportMode: 'wsInteractive',
      count: 380,
      renderRate: 90,
      avgRenderMs: 110,
      p95RenderMs: 250,
    });
  });

  it('should transform SDK versions correctly', () => {
    const aggs = {
      by_sdk_version: {
        buckets: [
          {
            key: 'v2.1.0',
            doc_count: 300,
            by_stage: {
              buckets: {
                received: { doc_count: 290 },
                rendered: { doc_count: 280, avg_render_ms: { value: 95 } },
              },
            },
          },
        ],
      },
    };

    const result = service.transformSdkVersions(aggs, ctx);

    expect(result[0]).toMatchObject({
      sdkVersion: 'v2.1.0',
      count: 300,
      renderRate: 96.55,
      avgRenderMs: 95,
    });
  });

  it('should transform failures correctly', () => {
    const aggs = {
      by_reason: {
        buckets: [
          {
            key: 'timeout',
            by_step: {
              buckets: [
                { key: 'render', doc_count: 10 },
                { key: 'ack', doc_count: 5 },
              ],
            },
          },
        ],
      },
    };

    const result = service.transformFailures(aggs, ctx);

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      failureReason: 'timeout',
      failureStep: 'render',
      count: 10,
      percentOfFailed: 66.67,
    });
    expect(result[1]).toMatchObject({
      failureReason: 'timeout',
      failureStep: 'ack',
      count: 5,
      percentOfFailed: 33.33,
    });
  });

  it('should transform latency correctly', () => {
    const aggs = {
      receive_latency: {
        values: { '50.0': 10, '75.0': 15, '95.0': 25, '99.0': 40 },
      },
      render_latency: {
        values: { '50.0': 50, '75.0': 75, '95.0': 120, '99.0': 200 },
      },
      ack_latency: { values: { '50.0': 2, '75.0': 3, '95.0': 5, '99.0': 10 } },
      receive_stats: { avg: 12, max: 50 },
      render_stats: { avg: 60, max: 250 },
      ack_stats: { avg: 2.5, max: 15 },
      render_duration: { values: { '50.0': 50, '95.0': 120, '99.0': 200 } },
      render_duration_stats: { avg: 61, max: 250 },
    };

    const result = service.transformLatency(aggs, ctx);

    expect(result.receive).toMatchObject({
      p50: 10,
      p75: 15,
      p95: 25,
      p99: 40,
      avg: 12,
      max: 50,
    });
    expect(result.render).toMatchObject({
      p50: 50,
      p75: 75,
      p95: 120,
      p99: 200,
      avg: 60,
      max: 250,
    });
    expect(result.ack).toMatchObject({
      p50: 2,
      p75: 3,
      p95: 5,
      p99: 10,
      avg: 2.5,
      max: 15,
    });
    expect(result.renderDuration).toMatchObject({
      p50: 50,
      p95: 120,
      p99: 200,
      avg: 61,
    });
  });

  it('should transform timeseries correctly', () => {
    const aggs = {
      timeseries: {
        buckets: [
          {
            key: 1705312800000,
            metric_value: { value: 42 },
          },
        ],
      },
    };

    const result = service.transformTimeseries(aggs, ctx, 'sent', '5m');

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      metric: 'sent',
      interval: '5m',
      value: 42,
    });
    expect(result[0].time).toEqual(new Date(1705312800000));
  });

  it('should return empty array for empty aggregations', () => {
    expect(service.transformPlatformMetrics({}, ctx)).toEqual([]);
    expect(service.transformDeviceBreakdown({}, ctx, 'browser')).toEqual([]);
    expect(service.transformTransportComparison({}, ctx)).toEqual([]);
    expect(service.transformSdkVersions({}, ctx)).toEqual([]);
    expect(service.transformFailures({}, ctx)).toEqual([]);
    expect(service.transformTimeseries({}, ctx, 'sent', '5m')).toEqual([]);
  });
});
