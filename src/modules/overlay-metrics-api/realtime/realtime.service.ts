import { Injectable, Logger } from '@nestjs/common';
import { ExtractorService } from '@modules/overlay-metrics-etl/extractor/extractor.service';
import { TransformerService } from '@modules/overlay-metrics-etl/transformer/transformer.service';
import { RealtimeQueryDto, RealtimeDeviceQueryDto, RealtimeTimeseriesQueryDto } from './realtime-query.dto';

/**
 * Service query tracking metrics trực tiếp từ Elasticsearch (realtime).
 * Re-use ExtractorService + TransformerService đã có sẵn.
 * Trả về data format tương thích với backend's TrackingModule DTOs.
 */
@Injectable()
export class RealtimeService {
  private readonly logger = new Logger(RealtimeService.name);

  constructor(
    private readonly extractor: ExtractorService,
    private readonly transformer: TransformerService,
  ) {}

  /**
   * Funnel metrics: sent, received, rendered, failed + rates.
   */
  async getFunnel(query: RealtimeQueryDto, tenantId: string) {
    const esQuery = this.buildEsQuery(query, tenantId);
    const agg = await this.extractor.extractPlatformMetrics(esQuery);
    const ctx = this.buildContext(query, tenantId);
    const data = this.transformer.transformPlatformMetrics(agg.aggregations, ctx);

    // Aggregate across all platforms into single funnel
    let sent = 0, received = 0, rendered = 0, failed = 0;
    for (const item of data) {
      sent += item.sent;
      received += item.received;
      rendered += item.rendered;
      failed += item.failed;
    }

    return {
      sent,
      received,
      rendered,
      failed,
      receiveRate: this.calcRate(received, sent),
      renderRate: this.calcRate(rendered, received),
      failureRate: this.calcRate(failed, received),
      netSuccessRate: this.calcRate(rendered, sent),
    };
  }

  /**
   * Latency percentiles: receive, render, ack, renderDuration.
   */
  async getLatency(query: RealtimeQueryDto, tenantId: string) {
    const esQuery = this.buildEsQuery(query, tenantId);
    const agg = await this.extractor.extractLatency(esQuery);
    const ctx = this.buildContext(query, tenantId);
    const data = this.transformer.transformLatency(agg.aggregations, ctx);
    return data;
  }

  /**
   * Failure analysis: reason × step breakdown.
   */
  async getFailures(query: RealtimeQueryDto, tenantId: string) {
    const esQuery = this.buildEsQuery(query, tenantId);
    const agg = await this.extractor.extractFailures(esQuery);
    const ctx = this.buildContext(query, tenantId);
    const data = this.transformer.transformFailures(agg.aggregations, ctx);
    return data.map((item) => ({
      failureReason: item.failureReason,
      failureStep: item.failureStep,
      count: item.count,
      percentOfFailed: item.percentOfFailed,
    }));
  }

  /**
   * Device breakdown: browser, os, or deviceClass.
   */
  async getDeviceBreakdown(query: RealtimeDeviceQueryDto, tenantId: string) {
    const dimension = query.dimension || 'browser';
    const esQuery = this.buildEsQuery(query, tenantId);
    const agg = await this.extractor.extractDeviceBreakdown(esQuery, dimension);
    const ctx = this.buildContext(query, tenantId);
    const data = this.transformer.transformDeviceBreakdown(agg.aggregations, ctx, dimension);
    return data.map((item) => ({
      dimension: item.bucketKey,
      received: item.received,
      rendered: item.rendered,
      failed: item.failed,
      renderRate: item.renderRate,
      avgRenderMs: item.avgRenderMs,
    }));
  }

  /**
   * Transport comparison: WebSocket vs Long Polling.
   */
  async getTransportComparison(query: RealtimeQueryDto, tenantId: string) {
    const esQuery = this.buildEsQuery(query, tenantId);
    const agg = await this.extractor.extractTransportComparison(esQuery);
    const ctx = this.buildContext(query, tenantId);
    const data = this.transformer.transformTransportComparison(agg.aggregations, ctx);
    return data.map((item) => ({
      transportMode: item.transportMode,
      count: item.count,
      renderRate: item.renderRate,
      avgRenderMs: item.avgRenderMs,
      p95RenderMs: item.p95RenderMs,
    }));
  }

  /**
   * SDK version distribution.
   */
  async getSdkVersions(query: RealtimeQueryDto, tenantId: string) {
    const esQuery = this.buildEsQuery(query, tenantId);
    const agg = await this.extractor.extractSdkVersions(esQuery);
    const ctx = this.buildContext(query, tenantId);
    const data = this.transformer.transformSdkVersions(agg.aggregations, ctx);
    return data.map((item) => ({
      sdkVersion: item.sdkVersion,
      count: item.count,
      renderRate: item.renderRate,
      avgRenderMs: item.avgRenderMs,
    }));
  }

  /**
   * Timeseries data cho biểu đồ xu hướng.
   */
  async getTimeseries(query: RealtimeTimeseriesQueryDto, tenantId: string) {
    const metric = query.metric || 'sent';
    const interval = query.interval || '1m';
    const esQuery = this.buildEsQuery(query, tenantId);
    const agg = await this.extractor.extractTimeseries(esQuery, metric, interval);
    const ctx = this.buildContext(query, tenantId);
    const data = this.transformer.transformTimeseries(agg.aggregations, ctx, metric, interval);
    return data.map((item) => ({
      time: item.time,
      value: item.value,
    }));
  }

  /**
   * Heatmap (platform breakdown) — dùng platform metrics.
   */
  async getHeatmap(query: RealtimeQueryDto, tenantId: string) {
    const esQuery = this.buildEsQuery(query, tenantId);
    const agg = await this.extractor.extractPlatformMetrics(esQuery);
    const ctx = this.buildContext(query, tenantId);
    const data = this.transformer.transformPlatformMetrics(agg.aggregations, ctx);
    return data.map((item) => ({
      platform: item.platform,
      sent: item.sent,
      received: item.received,
      rendered: item.rendered,
      failed: item.failed,
    }));
  }

  private buildEsQuery(query: RealtimeQueryDto, tenantId: string) {
    return {
      timelineIds: query.timelineIds?.length ? query.timelineIds : undefined,
      tenantId,
      from: query.from ? new Date(query.from) : undefined,
      to: query.to ? new Date(query.to) : undefined,
      platform: query.platform,
    };
  }

  private buildContext(query: RealtimeQueryDto, tenantId: string) {
    return {
      timelineId: query.timelineIds?.[0] || '',
      matchId: '',
      tenantId,
      intervalFrom: query.from ? new Date(query.from) : new Date(0),
      intervalTo: query.to ? new Date(query.to) : new Date(),
    };
  }

  private calcRate(numerator: number, denominator: number): number {
    if (denominator <= 0) return 0;
    return Math.round((numerator / denominator) * 10000) / 100;
  }
}
