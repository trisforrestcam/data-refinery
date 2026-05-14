import type {
  PlatformMetricsAggs,
  TimeseriesAggs,
} from '../../src/modules/overlay-metrics-etl/extractor/elasticsearch/types/tracking-es-aggs.types';
import {
  TransformerService,
  type TransformContext,
} from '../../src/modules/overlay-metrics-etl/transformer/transformer.service';

type TransformerServiceInternals = {
  normalizeValue: (value: unknown) => number;
  calculateRate: (numerator: unknown, denominator: unknown) => number;
};

describe('UC-16 - Math edge cases cho TransformerService', () => {
  let service: TransformerService;
  let internals: TransformerServiceInternals;

  const ctx: TransformContext = {
    timelineId: 'timeline-uc-16',
    matchId: 'match-uc-16',
    tenantId: 'tenant-uc-16',
    intervalFrom: new Date('2026-05-13T10:00:00.000Z'),
    intervalTo: new Date('2026-05-13T10:05:00.000Z'),
  };

  beforeEach(() => {
    service = new TransformerService();
    internals = service as unknown as TransformerServiceInternals;
  });

  describe('normalizeValue', () => {
    it('trả về 0 cho null, undefined, NaN và non-number inputs', () => {
      expect(internals.normalizeValue(null)).toBe(0);
      expect(internals.normalizeValue(undefined)).toBe(0);
      expect(internals.normalizeValue(Number.NaN)).toBe(0);
      expect(internals.normalizeValue('123')).toBe(0);
      expect(internals.normalizeValue(true)).toBe(0);
      expect(internals.normalizeValue(new Number(5))).toBe(0);
    });

    it('trả về 0 cho Infinity và -Infinity vì source chỉ chấp nhận finite numbers', () => {
      expect(internals.normalizeValue(Number.POSITIVE_INFINITY)).toBe(0);
      expect(internals.normalizeValue(Number.NEGATIVE_INFINITY)).toBe(0);
    });

    it('round finite numbers về 2 chữ số thập phân và xử lý zero/extreme values', () => {
      expect(internals.normalizeValue(0)).toBe(0);
      expect(internals.normalizeValue(-0)).toBeCloseTo(0, 10);
      expect(internals.normalizeValue(123.456)).toBe(123.46);
      expect(internals.normalizeValue(0.005)).toBe(0.01);
      expect(internals.normalizeValue(-99.999)).toBe(-100);
      expect(internals.normalizeValue(Number.MAX_SAFE_INTEGER)).toBe(
        Number.MAX_SAFE_INTEGER,
      );
      expect(internals.normalizeValue(Number.MIN_VALUE)).toBe(0);
    });
  });

  describe('calculateRate', () => {
    it('tính rate cơ bản và cho phép rate > 100%', () => {
      expect(internals.calculateRate(50, 100)).toBe(50);
      expect(internals.calculateRate(0, 100)).toBe(0);
      expect(internals.calculateRate(150, 100)).toBe(150);
      expect(internals.calculateRate(-50, 100)).toBe(-50);
    });

    it('trả về 0 khi denominator không hợp lệ hoặc <= 0', () => {
      expect(internals.calculateRate(100, 0)).toBe(0);
      expect(internals.calculateRate(100, null)).toBe(0);
      expect(internals.calculateRate(100, undefined)).toBe(0);
      expect(internals.calculateRate(100, Number.NaN)).toBe(0);
    });

    it('round repeating/floating-point rates về 2 chữ số thập phân', () => {
      expect(internals.calculateRate(1, 3)).toBe(33.33);
      expect(internals.calculateRate(0.1, 0.3)).toBe(33.33);
    });
  });

  describe('integration with transform methods', () => {
    it('transformPlatformMetrics trả về các rates = 0 khi sent=0 và downstream counts cũng = 0', () => {
      const aggregations: PlatformMetricsAggs = {
        platforms: {
          buckets: [
            {
              key: 'web',
              sent: { doc_count: 0, room_size_sum: { value: 0 } },
              received: { doc_count: 0 },
              rendered: { doc_count: 0, avg_render_ms: { value: 12.345 } },
              failed: { doc_count: 0 },
            },
          ],
        },
      };

      const [item] = service.transformPlatformMetrics(aggregations, ctx);

      expect(item).toMatchObject({
        platform: 'web',
        sent: 0,
        received: 0,
        rendered: 0,
        failed: 0,
        receiveRate: 0,
        renderRate: 0,
        failureRate: 0,
      });
    });

    it('transformTimeseries normalize NaN value về 0', () => {
      const aggregations: TimeseriesAggs = {
        timeseries: {
          buckets: [
            {
              key: ctx.intervalFrom.getTime(),
              key_as_string: ctx.intervalFrom.toISOString(),
              metric_value: { value: Number.NaN },
            },
          ],
        },
      };

      const [point] = service.transformTimeseries(
        aggregations,
        ctx,
        'avgRenderMs',
        '5m',
      );

      expect(point).toMatchObject({
        timelineId: ctx.timelineId,
        matchId: ctx.matchId,
        tenantId: ctx.tenantId,
        metric: 'avgRenderMs',
        interval: '5m',
        time: ctx.intervalFrom,
        value: 0,
        intervalFrom: ctx.intervalFrom,
        intervalTo: ctx.intervalTo,
      });
    });
  });
});
