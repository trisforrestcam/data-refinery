import { Injectable } from '@nestjs/common';
import {
  PlatformMetricDto,
  DeviceBreakdownDto,
  TransportComparisonDto,
  SdkVersionDto,
  FailureAnalysisDto,
  LatencyPercentileDto,
  TimeseriesPointDto,
} from '@domain/dto';
import { TransformContext } from '@modules/overlay-metrics-etl/interfaces/transform-context.interface';
import {
  PlatformMetricsAggs,
  DeviceBreakdownAggs,
  TransportComparisonAggs,
  SdkVersionAggs,
  FailureAggs,
  LatencyAggs,
  TimeseriesAggs,
  EsAggStats,
  EsAggValues,
} from '@modules/overlay-metrics-etl/extractor/elasticsearch/types/tracking-es-aggs.types';

export type { TransformContext };

/**
 * Transformer chuyển Elasticsearch aggregation results thành DTOs để persist vào MongoDB.
 * Là tầng giữa Extractor và Loader — đảm bảo dữ liệu được chuẩn hóa trước khi lưu.
 * Tính derived metrics (rate, percentile) tại đây để API read không cần tính toán lại.
 */
@Injectable()
export class TransformerService {
  /**
   * Transform platform metrics từ ES aggregation.
   * Tính sent (sum room_size), received/rendered/failed (doc_count),
   * và các derived rates để UI không cần tính lại.
   */
  transformPlatformMetrics(
    aggregations: PlatformMetricsAggs | undefined,
    ctx: TransformContext,
  ): PlatformMetricDto[] {
    const buckets = aggregations?.platforms?.buckets ?? [];

    return buckets.map((bucket) => {
      const sent = this.normalizeValue(bucket.sent?.room_size_sum?.value);
      const received = this.normalizeValue(bucket.received?.doc_count);
      const rendered = this.normalizeValue(bucket.rendered?.doc_count);
      const failed = this.normalizeValue(bucket.failed?.doc_count);

      return {
        timelineId: ctx.timelineId,
        matchId: ctx.matchId,
        tenantId: ctx.tenantId,
        platform: String(bucket.key || 'unknown'),
        sent,
        received,
        rendered,
        failed,
        receiveRate: this.calculateRate(received, sent),
        renderRate: this.calculateRate(rendered, received),
        failureRate: this.calculateRate(failed, received),
        netSuccessRate: this.calculateRate(rendered, sent),
        avgRenderMs: this.normalizeValue(bucket.rendered?.avg_render_ms?.value),
        intervalFrom: ctx.intervalFrom,
        intervalTo: ctx.intervalTo,
      };
    });
  }

  /**
   * Transform device breakdown theo dimension (browser / os / deviceClass).
   * Chạy 3 lần trong processor — mỗi lần 1 dimension để có đủ dữ liệu tab "Thiết bị".
   */
  transformDeviceBreakdown(
    aggregations: DeviceBreakdownAggs | undefined,
    ctx: TransformContext,
    dimension: string,
  ): DeviceBreakdownDto[] {
    const buckets = aggregations?.by_dimension?.buckets ?? [];

    return buckets.map((bucket) => {
      const stageBuckets = bucket.by_stage?.buckets;
      const received = this.normalizeValue(stageBuckets?.received?.doc_count);
      const rendered = this.normalizeValue(stageBuckets?.rendered?.doc_count);
      const failed = this.normalizeValue(stageBuckets?.failed?.doc_count);

      return {
        timelineId: ctx.timelineId,
        matchId: ctx.matchId,
        tenantId: ctx.tenantId,
        dimension,
        bucketKey: String(bucket.key || 'unknown'),
        received,
        rendered,
        failed,
        renderRate: this.calculateRate(rendered, received),
        avgRenderMs: this.normalizeValue(
          stageBuckets?.rendered?.avg_render_ms?.value,
        ),
        intervalFrom: ctx.intervalFrom,
        intervalTo: ctx.intervalTo,
      };
    });
  }

  /**
   * Transform transport comparison: WebSocket vs Long Polling.
   * Tính render rate và p95 render duration để so sánh hiệu suất protocol.
   */
  transformTransportComparison(
    aggregations: TransportComparisonAggs | undefined,
    ctx: TransformContext,
  ): TransportComparisonDto[] {
    const buckets = aggregations?.by_transport?.buckets ?? [];

    return buckets.map((bucket) => {
      const stageBuckets = bucket.by_stage?.buckets;
      const received = this.normalizeValue(stageBuckets?.received?.doc_count);
      const rendered = this.normalizeValue(stageBuckets?.rendered?.doc_count);

      return {
        timelineId: ctx.timelineId,
        matchId: ctx.matchId,
        tenantId: ctx.tenantId,
        transportMode: String(bucket.key || 'unknown'),
        count: this.normalizeValue(bucket.doc_count ?? received + rendered),
        renderRate: this.calculateRate(rendered, received),
        avgRenderMs: this.normalizeValue(
          stageBuckets?.rendered?.avg_render_ms?.value,
        ),
        p95RenderMs: this.normalizeValue(
          stageBuckets?.rendered?.p95_render_ms?.values?.['95.0'],
        ),
        intervalFrom: ctx.intervalFrom,
        intervalTo: ctx.intervalTo,
      };
    });
  }

  /**
   * Transform SDK version distribution.
   * Giúp team biết version nào đang active để quyết định deprecate hoặc fix bug.
   */
  transformSdkVersions(
    aggregations: SdkVersionAggs | undefined,
    ctx: TransformContext,
  ): SdkVersionDto[] {
    const buckets = aggregations?.by_sdk_version?.buckets ?? [];

    return buckets.map((bucket) => {
      const stageBuckets = bucket.by_stage?.buckets;
      const received = this.normalizeValue(stageBuckets?.received?.doc_count);
      const rendered = this.normalizeValue(stageBuckets?.rendered?.doc_count);

      return {
        timelineId: ctx.timelineId,
        matchId: ctx.matchId,
        tenantId: ctx.tenantId,
        sdkVersion: String(bucket.key || 'unknown'),
        count: this.normalizeValue(bucket.doc_count),
        renderRate: this.calculateRate(rendered, received),
        avgRenderMs: this.normalizeValue(
          stageBuckets?.rendered?.avg_render_ms?.value,
        ),
        intervalFrom: ctx.intervalFrom,
        intervalTo: ctx.intervalTo,
      };
    });
  }

  /**
   * Transform failure analysis: lý do lỗi × bước lỗi.
   * Tính percentOfFailed để biết lỗi nào chiếm tỷ lệ cao nhất trong tổng số lỗi.
   */
  transformFailures(
    aggregations: FailureAggs | undefined,
    ctx: TransformContext,
  ): FailureAnalysisDto[] {
    const reasonBuckets = aggregations?.by_reason?.buckets ?? [];
    let totalFailed = 0;

    for (const reasonBucket of reasonBuckets) {
      const stepBuckets = reasonBucket.by_step?.buckets ?? [];
      for (const stepBucket of stepBuckets) {
        totalFailed += this.normalizeValue(stepBucket.doc_count);
      }
    }

    const results: FailureAnalysisDto[] = [];

    for (const reasonBucket of reasonBuckets) {
      const reason = String(reasonBucket.key || 'unknown');
      const stepBuckets = reasonBucket.by_step?.buckets ?? [];

      for (const stepBucket of stepBuckets) {
        const count = this.normalizeValue(stepBucket.doc_count);
        results.push({
          timelineId: ctx.timelineId,
          matchId: ctx.matchId,
          tenantId: ctx.tenantId,
          failureReason: reason,
          failureStep: String(stepBucket.key || 'unknown'),
          count,
          percentOfFailed:
            totalFailed > 0
              ? this.normalizeValue((count / totalFailed) * 100)
              : 0,
          intervalFrom: ctx.intervalFrom,
          intervalTo: ctx.intervalTo,
        });
      }
    }

    return results;
  }

  /**
   * Transform latency percentiles: receive, render, ack, renderDuration.
   * Dữ liệu này giúp đánh giá độ trễ hệ thống ở các ngưỡng p50/p75/p95/p99.
   */
  transformLatency(
    aggregations: LatencyAggs | undefined,
    ctx: TransformContext,
  ): LatencyPercentileDto {
    const mapP = (
      values: EsAggValues['values'] | undefined,
      stats: EsAggStats | undefined,
    ) => ({
      p50: this.normalizeValue(values?.['50.0']),
      p75: this.normalizeValue(values?.['75.0']),
      p95: this.normalizeValue(values?.['95.0']),
      p99: this.normalizeValue(values?.['99.0']),
      avg: this.normalizeValue(stats?.avg),
      max: this.normalizeValue(stats?.max),
    });

    return {
      timelineId: ctx.timelineId,
      matchId: ctx.matchId,
      tenantId: ctx.tenantId,
      receive: mapP(
        aggregations?.receive_latency?.values,
        aggregations?.receive_stats,
      ),
      render: mapP(
        aggregations?.render_latency?.values,
        aggregations?.render_stats,
      ),
      ack: mapP(aggregations?.ack_latency?.values, aggregations?.ack_stats),
      renderDuration: {
        p50: this.normalizeValue(
          aggregations?.render_latency?.values?.['50.0'],
        ),
        p95: this.normalizeValue(
          aggregations?.render_latency?.values?.['95.0'],
        ),
        p99: this.normalizeValue(
          aggregations?.render_latency?.values?.['99.0'],
        ),
        avg: this.normalizeValue(aggregations?.render_stats?.avg),
      },
      intervalFrom: ctx.intervalFrom,
      intervalTo: ctx.intervalTo,
    };
  }

  /**
   * Transform timeseries data cho biểu đồ xu hướng.
   * Mỗi metric (sent, received, rendered, failed, avgRenderMs) chạy 1 lần
   * để có đủ series cho biểu đồ 5m interval.
   */
  transformTimeseries(
    aggregations: TimeseriesAggs | undefined,
    ctx: TransformContext,
    metric: string,
    interval: string,
  ): TimeseriesPointDto[] {
    const buckets = aggregations?.timeseries?.buckets ?? [];

    return buckets.map((bucket) => ({
      timelineId: ctx.timelineId,
      matchId: ctx.matchId,
      tenantId: ctx.tenantId,
      metric,
      interval,
      time: new Date(bucket.key_as_string ?? bucket.key ?? Date.now()),
      value:
        bucket.metric_value?.doc_count !== undefined
          ? this.normalizeValue(bucket.metric_value.doc_count)
          : this.normalizeValue(bucket.metric_value?.value ?? 0),
      intervalFrom: ctx.intervalFrom,
      intervalTo: ctx.intervalTo,
    }));
  }

  /**
   * Chuẩn hóa giá trị từ ES: null/undefined → 0, làm tròn 2 chữ số thập phân.
   * Tránh NaN hoặc Infinity lọt vào MongoDB gây lỗi schema validation.
   */
  private normalizeValue(value: number | null | undefined): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
    return Math.round(value * 100) / 100;
  }

  /**
   * Tính tỷ lệ phần trăm và chuẩn hóa.
   * Dùng cho receiveRate, renderRate, failureRate, netSuccessRate.
   * Tránh chia cho 0 — nếu denominator <= 0 thì trả về 0%.
   */
  private calculateRate(numerator: number, denominator: number): number {
    if (denominator <= 0) return 0;
    return this.normalizeValue((numerator / denominator) * 100);
  }
}
