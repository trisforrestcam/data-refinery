# Implementation Guide — ETL Pipeline chi tiết

## 1. Extractor Module

### File: `src/modules/extractor/elasticsearch/tracking-es.service.ts`

Service này thay thế `ApmElasticsearchService` hiện tại, chuyên dùng cho **tracking index** (không phải APM index).

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ElasticsearchService } from '@nestjs/elasticsearch';

export interface TrackingAggQuery {
  timelineIds?: string[];
  mediaContentId?: string;
  tenantId: string;
  from?: Date;
  to?: Date;
  platform?: string;
}

export interface TrackingAggResult {
  aggregations: Record<string, any>;
  took: number;
}

@Injectable()
export class TrackingEsService {
  private readonly logger = new Logger(TrackingEsService.name);

  constructor(
    private readonly esService: ElasticsearchService,
    private readonly configService: ConfigService,
  ) {}

  private getIndex(): string {
    return this.configService.getOrThrow<string>('TRACKING_ES_INDEX');
  }

  private buildBaseQuery(query: TrackingAggQuery): Record<string, any> {
    const must: any[] = [
      { term: { 'labels.tenant_id': query.tenantId } },
      { term: { 'labels.environment': this.configService.get('ELASTIC_APM_ENVIRONMENT', 'development') } },
    ];

    if (query.timelineIds?.length) {
      must.push({ terms: { 'labels.timeline_id': query.timelineIds } });
    }

    if (query.mediaContentId) {
      must.push({ term: { 'labels.media_content_id': query.mediaContentId } });
    }

    if (query.from && query.to) {
      must.push({
        range: {
          '@timestamp': {
            gte: query.from.toISOString(),
            lte: query.to.toISOString(),
          },
        },
      });
    }

    if (query.platform) {
      must.push({ term: { 'labels.platform': query.platform } });
    }

    return { bool: { must } };
  }

  async queryPlatformMetrics(query: TrackingAggQuery): Promise<TrackingAggResult> {
    const esQuery = this.buildBaseQuery(query);
    
    const result = await this.esService.search({
      index: this.getIndex(),
      size: 0,
      query: esQuery,
      aggs: {
        platforms: {
          terms: { field: 'labels.platform', size: 100, missing: 'unknown' },
          aggs: {
            sent: {
              filter: { term: { 'labels.stage': 'sent' } },
              aggs: { room_size_sum: { sum: { field: 'numeric_labels.room_size' } } },
            },
            received: { filter: { term: { 'labels.stage': 'received' } } },
            rendered: {
              filter: { term: { 'labels.stage': 'rendered' } },
              aggs: { avg_render_ms: { avg: { field: 'numeric_labels.render_duration_ms' } } },
            },
            failed: { filter: { term: { 'labels.stage': 'render-failed' } } },
          },
        },
      },
    });

    return { aggregations: (result as any).aggregations, took: (result as any).took };
  }

  async queryDeviceBreakdown(query: TrackingAggQuery, dimension: string): Promise<TrackingAggResult> {
    const fieldMap: Record<string, string> = {
      browser: 'labels.browser',
      os: 'labels.client_os',
      deviceClass: 'labels.device_class',
    };

    const esQuery = this.buildBaseQuery(query);

    const result = await this.esService.search({
      index: this.getIndex(),
      size: 0,
      query: esQuery,
      aggs: {
        by_dimension: {
          terms: { field: fieldMap[dimension] || fieldMap.browser, size: 50, missing: 'unknown' },
          aggs: {
            by_stage: {
              filters: {
                filters: {
                  received: { term: { 'labels.stage': 'received' } },
                  rendered: { term: { 'labels.stage': 'rendered' } },
                  failed: { term: { 'labels.stage': 'render-failed' } },
                },
              },
              aggs: {
                avg_render_ms: { avg: { field: 'numeric_labels.render_duration_ms' } },
              },
            },
          },
        },
      },
    });

    return { aggregations: (result as any).aggregations, took: (result as any).took };
  }

  async queryTransportComparison(query: TrackingAggQuery): Promise<TrackingAggResult> {
    const esQuery = this.buildBaseQuery(query);

    const result = await this.esService.search({
      index: this.getIndex(),
      size: 0,
      query: esQuery,
      aggs: {
        by_transport: {
          terms: { field: 'labels.transport_mode', size: 10, missing: 'unknown' },
          aggs: {
            by_stage: {
              filters: {
                filters: {
                  received: { term: { 'labels.stage': 'received' } },
                  rendered: { term: { 'labels.stage': 'rendered' } },
                },
              },
              aggs: {
                avg_render_ms: { avg: { field: 'numeric_labels.render_duration_ms' } },
                p95_render_ms: { percentiles: { field: 'numeric_labels.render_duration_ms', percents: [95] } },
              },
            },
          },
        },
      },
    });

    return { aggregations: (result as any).aggregations, took: (result as any).took };
  }

  async querySdkVersions(query: TrackingAggQuery): Promise<TrackingAggResult> {
    const esQuery = this.buildBaseQuery(query);

    const result = await this.esService.search({
      index: this.getIndex(),
      size: 0,
      query: esQuery,
      aggs: {
        by_sdk_version: {
          terms: { field: 'labels.sdk_version', size: 50, missing: 'unknown' },
          aggs: {
            by_stage: {
              filters: {
                filters: {
                  received: { term: { 'labels.stage': 'received' } },
                  rendered: { term: { 'labels.stage': 'rendered' } },
                },
              },
              aggs: {
                avg_render_ms: { avg: { field: 'numeric_labels.render_duration_ms' } },
              },
            },
          },
        },
      },
    });

    return { aggregations: (result as any).aggregations, took: (result as any).took };
  }

  async queryFailures(query: TrackingAggQuery): Promise<TrackingAggResult> {
    const esQuery = this.buildBaseQuery(query);

    const result = await this.esService.search({
      index: this.getIndex(),
      size: 0,
      query: esQuery,
      aggs: {
        by_reason: {
          terms: { field: 'labels.failure_reason', size: 50 },
          aggs: {
            by_step: { terms: { field: 'labels.failure_step', size: 20 } },
          },
        },
      },
    });

    return { aggregations: (result as any).aggregations, took: (result as any).took };
  }

  async queryLatency(query: TrackingAggQuery): Promise<TrackingAggResult> {
    const esQuery = this.buildBaseQuery(query);

    const result = await this.esService.search({
      index: this.getIndex(),
      size: 0,
      query: esQuery,
      aggs: {
        receive_latency: { percentiles: { field: 'numeric_labels.receive_latency_ms', percents: [50, 75, 95, 99] } },
        render_latency: { percentiles: { field: 'numeric_labels.render_duration_ms', percents: [50, 75, 95, 99] } },
        ack_latency: { percentiles: { field: 'numeric_labels.ack_latency_ms', percents: [50, 75, 95, 99] } },
        receive_stats: { stats: { field: 'numeric_labels.receive_latency_ms' } },
        render_stats: { stats: { field: 'numeric_labels.render_duration_ms' } },
        ack_stats: { stats: { field: 'numeric_labels.ack_latency_ms' } },
        render_duration: { percentiles: { field: 'numeric_labels.render_duration_ms', percents: [50, 95, 99] } },
      },
    });

    return { aggregations: (result as any).aggregations, took: (result as any).took };
  }

  async queryTimeseries(
    query: TrackingAggQuery,
    metric: string,
    interval: string,
  ): Promise<TrackingAggResult> {
    const esQuery = this.buildBaseQuery(query);

    const metricMap: Record<string, { type: string; field?: string }> = {
      sent: { type: 'sum', field: 'numeric_labels.room_size' },
      received: { type: 'count' },
      rendered: { type: 'count' },
      failed: { type: 'count' },
      avgRenderMs: { type: 'avg', field: 'numeric_labels.render_duration_ms' },
    };

    const config = metricMap[metric] || metricMap.sent;
    let metricAgg: Record<string, any> = {};

    if (config.type === 'sum') {
      metricAgg = { sum: { field: config.field } };
    } else if (config.type === 'avg') {
      metricAgg = { avg: { field: config.field } };
    } else if (['received', 'rendered', 'failed'].includes(metric)) {
      const stageMap: Record<string, string> = {
        received: 'received',
        rendered: 'rendered',
        failed: 'render-failed',
      };
      metricAgg = { filter: { term: { 'labels.stage': stageMap[metric] } } };
    }

    const result = await this.esService.search({
      index: this.getIndex(),
      size: 0,
      query: esQuery,
      aggs: {
        timeseries: {
          date_histogram: { field: '@timestamp', fixed_interval: interval },
          aggs: { metric_value: metricAgg },
        },
      },
    });

    return { aggregations: (result as any).aggregations, took: (result as any).took };
  }
}
```

### File: `src/modules/extractor/extractor.service.ts`

```typescript
import { Injectable } from '@nestjs/common';
import { TrackingEsService, TrackingAggQuery } from './elasticsearch/tracking-es.service';

@Injectable()
export class ExtractorService {
  constructor(private readonly trackingEsService: TrackingEsService) {}

  async extractPlatformMetrics(query: TrackingAggQuery) {
    return this.trackingEsService.queryPlatformMetrics(query);
  }

  async extractDeviceBreakdown(query: TrackingAggQuery, dimension: string) {
    return this.trackingEsService.queryDeviceBreakdown(query, dimension);
  }

  async extractTransportComparison(query: TrackingAggQuery) {
    return this.trackingEsService.queryTransportComparison(query);
  }

  async extractSdkVersions(query: TrackingAggQuery) {
    return this.trackingEsService.querySdkVersions(query);
  }

  async extractFailures(query: TrackingAggQuery) {
    return this.trackingEsService.queryFailures(query);
  }

  async extractLatency(query: TrackingAggQuery) {
    return this.trackingEsService.queryLatency(query);
  }

  async extractTimeseries(query: TrackingAggQuery, metric: string, interval: string) {
    return this.trackingEsService.queryTimeseries(query, metric, interval);
  }
}
```

---

## 2. Transformer Module

### File: `src/modules/transformer/transformer.service.ts`

```typescript
import { Injectable } from '@nestjs/common';
import {
  PlatformMetricDto,
  DeviceBreakdownDto,
  TransportComparisonDto,
  SdkVersionDto,
  FailureAnalysisDto,
  LatencyPercentileDto,
  TimeseriesPointDto,
} from './dto';

export interface TransformContext {
  timelineId: string;
  matchId: string;
  tenantId: string;
  intervalFrom: Date;
  intervalTo: Date;
}

@Injectable()
export class TransformerService {
  private normalizeValue(value: number | null | undefined): number {
    if (typeof value !== 'number' || Number.isNaN(value)) return 0;
    return Math.round(value * 100) / 100;
  }

  private calculateRate(numerator: number, denominator: number): number {
    if (denominator <= 0) return 0;
    return this.normalizeValue((numerator / denominator) * 100);
  }

  transformPlatformMetrics(aggregations: any, ctx: TransformContext): PlatformMetricDto[] {
    const buckets = aggregations?.platforms?.buckets || [];
    
    return buckets.map((bucket: any) => {
      const sent = this.normalizeValue(bucket?.sent?.room_size_sum?.value);
      const received = this.normalizeValue(bucket?.received?.doc_count);
      const rendered = this.normalizeValue(bucket?.rendered?.doc_count);
      const failed = this.normalizeValue(bucket?.failed?.doc_count);

      return {
        timelineId: ctx.timelineId,
        matchId: ctx.matchId,
        tenantId: ctx.tenantId,
        platform: bucket?.key || 'unknown',
        sent,
        received,
        rendered,
        failed,
        receiveRate: this.calculateRate(received, sent),
        renderRate: this.calculateRate(rendered, sent),
        failureRate: this.calculateRate(failed, received),
        avgRenderMs: this.normalizeValue(bucket?.rendered?.avg_render_ms?.value),
        intervalFrom: ctx.intervalFrom,
        intervalTo: ctx.intervalTo,
      };
    });
  }

  transformDeviceBreakdown(
    aggregations: any,
    ctx: TransformContext,
    dimension: string,
  ): DeviceBreakdownDto[] {
    const buckets = aggregations?.by_dimension?.buckets || [];

    return buckets.map((bucket: any) => {
      const stageBuckets = bucket?.by_stage?.buckets;
      const received = this.normalizeValue(stageBuckets?.received?.doc_count);
      const rendered = this.normalizeValue(stageBuckets?.rendered?.doc_count);
      const failed = this.normalizeValue(stageBuckets?.failed?.doc_count);

      return {
        timelineId: ctx.timelineId,
        matchId: ctx.matchId,
        tenantId: ctx.tenantId,
        dimension,
        bucketKey: bucket?.key || 'unknown',
        received,
        rendered,
        failed,
        renderRate: this.calculateRate(rendered, received),
        avgRenderMs: this.normalizeValue(stageBuckets?.rendered?.avg_render_ms?.value),
        intervalFrom: ctx.intervalFrom,
        intervalTo: ctx.intervalTo,
      };
    });
  }

  transformTransportComparison(
    aggregations: any,
    ctx: TransformContext,
  ): TransportComparisonDto[] {
    const buckets = aggregations?.by_transport?.buckets || [];

    return buckets.map((bucket: any) => {
      const stageBuckets = bucket?.by_stage?.buckets;
      const received = this.normalizeValue(stageBuckets?.received?.doc_count);
      const rendered = this.normalizeValue(stageBuckets?.rendered?.doc_count);

      return {
        timelineId: ctx.timelineId,
        matchId: ctx.matchId,
        tenantId: ctx.tenantId,
        transportMode: bucket?.key || 'unknown',
        count: received + rendered,
        renderRate: this.calculateRate(rendered, received),
        avgRenderMs: this.normalizeValue(stageBuckets?.rendered?.avg_render_ms?.value),
        p95RenderMs: this.normalizeValue(stageBuckets?.rendered?.p95_render_ms?.values?.['95.0']),
        intervalFrom: ctx.intervalFrom,
        intervalTo: ctx.intervalTo,
      };
    });
  }

  transformSdkVersions(aggregations: any, ctx: TransformContext): SdkVersionDto[] {
    const buckets = aggregations?.by_sdk_version?.buckets || [];

    return buckets.map((bucket: any) => {
      const stageBuckets = bucket?.by_stage?.buckets;
      const received = this.normalizeValue(stageBuckets?.received?.doc_count);
      const rendered = this.normalizeValue(stageBuckets?.rendered?.doc_count);

      return {
        timelineId: ctx.timelineId,
        matchId: ctx.matchId,
        tenantId: ctx.tenantId,
        sdkVersion: bucket?.key || 'unknown',
        count: this.normalizeValue(bucket?.doc_count),
        renderRate: this.calculateRate(rendered, received),
        avgRenderMs: this.normalizeValue(stageBuckets?.rendered?.avg_render_ms?.value),
        intervalFrom: ctx.intervalFrom,
        intervalTo: ctx.intervalTo,
      };
    });
  }

  transformFailures(aggregations: any, ctx: TransformContext): FailureAnalysisDto[] {
    const reasonBuckets = aggregations?.by_reason?.buckets || [];
    let totalFailed = 0;

    for (const reasonBucket of reasonBuckets) {
      const stepBuckets = reasonBucket?.by_step?.buckets || [];
      for (const stepBucket of stepBuckets) {
        totalFailed += this.normalizeValue(stepBucket?.doc_count);
      }
    }

    const results: FailureAnalysisDto[] = [];

    for (const reasonBucket of reasonBuckets) {
      const reason = reasonBucket?.key || 'unknown';
      const stepBuckets = reasonBucket?.by_step?.buckets || [];

      for (const stepBucket of stepBuckets) {
        const count = this.normalizeValue(stepBucket?.doc_count);
        results.push({
          timelineId: ctx.timelineId,
          matchId: ctx.matchId,
          tenantId: ctx.tenantId,
          failureReason: reason,
          failureStep: stepBucket?.key || 'unknown',
          count,
          percentOfFailed: totalFailed > 0 ? this.normalizeValue((count / totalFailed) * 100) : 0,
          intervalFrom: ctx.intervalFrom,
          intervalTo: ctx.intervalTo,
        });
      }
    }

    return results;
  }

  transformLatency(aggregations: any, ctx: TransformContext): LatencyPercentileDto {
    const mapP = (values: any, stats: any) => ({
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
      receive: mapP(aggregations?.receive_latency?.values, aggregations?.receive_stats),
      render: mapP(aggregations?.render_latency?.values, aggregations?.render_stats),
      ack: mapP(aggregations?.ack_latency?.values, aggregations?.ack_stats),
      renderDuration: {
        p50: this.normalizeValue(aggregations?.render_duration?.values?.['50.0']),
        p95: this.normalizeValue(aggregations?.render_duration?.values?.['95.0']),
        p99: this.normalizeValue(aggregations?.render_duration?.values?.['99.0']),
        avg: this.normalizeValue(aggregations?.render_stats?.avg),
      },
      intervalFrom: ctx.intervalFrom,
      intervalTo: ctx.intervalTo,
    };
  }

  transformTimeseries(
    aggregations: any,
    ctx: TransformContext,
    metric: string,
    interval: string,
  ): TimeseriesPointDto[] {
    const buckets = aggregations?.timeseries?.buckets || [];

    return buckets.map((bucket: any) => ({
      timelineId: ctx.timelineId,
      matchId: ctx.matchId,
      tenantId: ctx.tenantId,
      metric,
      interval,
      time: bucket?.key_as_string || new Date(bucket?.key).toISOString(),
      value: bucket?.metric_value?.doc_count !== undefined
        ? this.normalizeValue(bucket?.metric_value?.doc_count)
        : this.normalizeValue(bucket?.metric_value?.value ?? bucket?.doc_count),
      intervalFrom: ctx.intervalFrom,
      intervalTo: ctx.intervalTo,
    }));
  }
}
```

---

## 3. Loader Module

### File: `src/modules/loader/loader.service.ts`

```typescript
import { Injectable, Logger } from '@nestjs/common';
import {
  OverlayMetricsPlatform,
  OverlayMetricsDevice,
  OverlayMetricsTransport,
  OverlayMetricsSdk,
  OverlayMetricsFailure,
  OverlayMetricsTimeseries,
  OverlayMetricsLatency,
} from './schemas';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

@Injectable()
export class LoaderService {
  private readonly logger = new Logger(LoaderService.name);

  constructor(
    @InjectModel(OverlayMetricsPlatform.name)
    private readonly platformModel: Model<OverlayMetricsPlatform>,
    @InjectModel(OverlayMetricsDevice.name)
    private readonly deviceModel: Model<OverlayMetricsDevice>,
    @InjectModel(OverlayMetricsTransport.name)
    private readonly transportModel: Model<OverlayMetricsTransport>,
    @InjectModel(OverlayMetricsSdk.name)
    private readonly sdkModel: Model<OverlayMetricsSdk>,
    @InjectModel(OverlayMetricsFailure.name)
    private readonly failureModel: Model<OverlayMetricsFailure>,
    @InjectModel(OverlayMetricsTimeseries.name)
    private readonly timeseriesModel: Model<OverlayMetricsTimeseries>,
    @InjectModel(OverlayMetricsLatency.name)
    private readonly latencyModel: Model<OverlayMetricsLatency>,
  ) {}

  private buildUpsertOps<T extends { timelineId: string; intervalFrom: Date; [key: string]: any }>(
    items: T[],
    uniqueFields: string[],
  ): any[] {
    return items.map((item) => {
      const filter: Record<string, any> = {};
      for (const field of uniqueFields) {
        filter[field] = item[field];
      }

      return {
        updateOne: {
          filter,
          update: { $set: item },
          upsert: true,
        },
      };
    });
  }

  async loadPlatformMetrics(items: any[]): Promise<void> {
    if (!items.length) return;
    const ops = this.buildUpsertOps(items, ['timelineId', 'platform', 'intervalFrom']);
    await this.platformModel.bulkWrite(ops);
    this.logger.log(`Upserted ${items.length} platform metrics`);
  }

  async loadDeviceBreakdown(items: any[]): Promise<void> {
    if (!items.length) return;
    const ops = this.buildUpsertOps(items, ['timelineId', 'dimension', 'bucketKey', 'intervalFrom']);
    await this.deviceModel.bulkWrite(ops);
    this.logger.log(`Upserted ${items.length} device breakdowns`);
  }

  async loadTransportComparison(items: any[]): Promise<void> {
    if (!items.length) return;
    const ops = this.buildUpsertOps(items, ['timelineId', 'transportMode', 'intervalFrom']);
    await this.transportModel.bulkWrite(ops);
    this.logger.log(`Upserted ${items.length} transport comparisons`);
  }

  async loadSdkVersions(items: any[]): Promise<void> {
    if (!items.length) return;
    const ops = this.buildUpsertOps(items, ['timelineId', 'sdkVersion', 'intervalFrom']);
    await this.sdkModel.bulkWrite(ops);
    this.logger.log(`Upserted ${items.length} SDK versions`);
  }

  async loadFailures(items: any[]): Promise<void> {
    if (!items.length) return;
    const ops = this.buildUpsertOps(items, ['timelineId', 'failureReason', 'failureStep', 'intervalFrom']);
    await this.failureModel.bulkWrite(ops);
    this.logger.log(`Upserted ${items.length} failures`);
  }

  async loadTimeseries(items: any[]): Promise<void> {
    if (!items.length) return;
    const ops = this.buildUpsertOps(items, ['timelineId', 'metric', 'interval', 'time']);
    await this.timeseriesModel.bulkWrite(ops);
    this.logger.log(`Upserted ${items.length} timeseries points`);
  }

  async loadLatency(items: any[]): Promise<void> {
    if (!items.length) return;
    const ops = this.buildUpsertOps(items, ['timelineId', 'metricType', 'intervalFrom']);
    await this.latencyModel.bulkWrite(ops);
    this.logger.log(`Upserted ${items.length} latency records`);
  }
}
```

---

## 4. Scheduler & Processor

### File: `src/modules/scheduler/scheduler.service.ts`

```typescript
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Queue } from 'bullmq';
import { InjectQueue } from '@nestjs/bullmq';

export const OVERLAY_METRICS_QUEUE = 'overlay-metrics' as const;
export const OVERLAY_METRICS_SCHEDULER_ID = 'overlay-metrics-every-5min' as const;
export const OVERLAY_METRICS_JOB = 'extract-transform-load-metrics' as const;

@Injectable()
export class SchedulerService implements OnModuleInit {
  private readonly logger = new Logger(SchedulerService.name);

  constructor(
    @InjectQueue(OVERLAY_METRICS_QUEUE)
    private readonly queue: Queue,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.queue.upsertJobScheduler(
      OVERLAY_METRICS_SCHEDULER_ID,
      { every: 5 * 60 * 1000 }, // 5 minutes
      {
        name: OVERLAY_METRICS_JOB,
        data: { timeRangeMinutes: 5 },
        opts: {
          attempts: 3,
          backoff: { type: 'exponential', delay: 5000 },
        },
      },
    );

    this.logger.log('Overlay metrics scheduler registered (every 5 minutes)');
  }
}
```

### File: `src/modules/scheduler/processors/overlay-metrics.processor.ts`

```typescript
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { ExtractorService } from '@modules/extractor/extractor.service';
import { TransformerService, TransformContext } from '@modules/transformer/transformer.service';
import { LoaderService } from '@modules/loader/loader.service';
import { OVERLAY_METRICS_QUEUE, OVERLAY_METRICS_JOB } from '../scheduler.service';

@Processor(OVERLAY_METRICS_QUEUE)
export class OverlayMetricsProcessor extends WorkerHost {
  private readonly logger = new Logger(OverlayMetricsProcessor.name);

  constructor(
    private readonly extractor: ExtractorService,
    private readonly transformer: TransformerService,
    private readonly loader: LoaderService,
  ) {
    super();
  }

  async process(job: Job): Promise<void> {
    if (job.name !== OVERLAY_METRICS_JOB) {
      this.logger.warn(`Unknown job name: ${job.name}`);
      return;
    }

    this.logger.log(`Processing job ${job.id}`);

    const now = new Date();
    const from = new Date(now.getTime() - job.data.timeRangeMinutes * 60 * 1000);

    // TODO: Lấy danh sách active timelineIds từ tournament service hoặc cache
    const timelineIds = job.data.timelineIds || [];
    const tenantId = job.data.tenantId;

    if (!timelineIds.length || !tenantId) {
      this.logger.warn('No timelineIds or tenantId provided, skipping');
      return;
    }

    const ctx: TransformContext = {
      timelineId: timelineIds[0], // Nếu nhiều timeline, loop qua từng cái
      matchId: job.data.matchId,
      tenantId,
      intervalFrom: from,
      intervalTo: now,
    };

    // 1. Platform Metrics
    const platformAgg = await this.extractor.extractPlatformMetrics({
      timelineIds,
      tenantId,
      from,
      to: now,
    });
    const platformData = this.transformer.transformPlatformMetrics(platformAgg.aggregations, ctx);
    await this.loader.loadPlatformMetrics(platformData);

    // 2. Device Breakdown (3 dimensions)
    for (const dimension of ['browser', 'os', 'deviceClass']) {
      const deviceAgg = await this.extractor.extractDeviceBreakdown({ timelineIds, tenantId, from, to: now }, dimension);
      const deviceData = this.transformer.transformDeviceBreakdown(deviceAgg.aggregations, ctx, dimension);
      await this.loader.loadDeviceBreakdown(deviceData);
    }

    // 3. Transport Comparison
    const transportAgg = await this.extractor.extractTransportComparison({ timelineIds, tenantId, from, to: now });
    const transportData = this.transformer.transformTransportComparison(transportAgg.aggregations, ctx);
    await this.loader.loadTransportComparison(transportData);

    // 4. SDK Versions
    const sdkAgg = await this.extractor.extractSdkVersions({ timelineIds, tenantId, from, to: now });
    const sdkData = this.transformer.transformSdkVersions(sdkAgg.aggregations, ctx);
    await this.loader.loadSdkVersions(sdkData);

    // 5. Failures
    const failureAgg = await this.extractor.extractFailures({ timelineIds, tenantId, from, to: now });
    const failureData = this.transformer.transformFailures(failureAgg.aggregations, ctx);
    await this.loader.loadFailures(failureData);

    // 6. Latency
    const latencyAgg = await this.extractor.extractLatency({ timelineIds, tenantId, from, to: now });
    const latencyData = this.transformer.transformLatency(latencyAgg.aggregations, ctx);
    await this.loader.loadLatency([latencyData]);

    // 7. Timeseries (multiple metrics)
    for (const metric of ['sent', 'received', 'rendered', 'failed', 'avgRenderMs']) {
      const tsAgg = await this.extractor.extractTimeseries({ timelineIds, tenantId, from, to: now }, metric, '5m');
      const tsData = this.transformer.transformTimeseries(tsAgg.aggregations, ctx, metric, '5m');
      await this.loader.loadTimeseries(tsData);
    }

    this.logger.log(`Job ${job.id} completed`);
  }
}
```

---

## 5. Wiring Module

### `src/modules/extractor/extractor.module.ts`

```typescript
import { Module } from '@nestjs/common';
import { ExtractorService } from './extractor.service';
import { TrackingEsService } from './elasticsearch/tracking-es.service';

@Module({
  providers: [ExtractorService, TrackingEsService],
  exports: [ExtractorService],
})
export class ExtractorModule {}
```

### `src/modules/transformer/transformer.module.ts`

```typescript
import { Module } from '@nestjs/common';
import { TransformerService } from './transformer.service';

@Module({
  providers: [TransformerService],
  exports: [TransformerService],
})
export class TransformerModule {}
```

### `src/modules/loader/loader.module.ts`

```typescript
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { LoaderService } from './loader.service';
import {
  OverlayMetricsPlatform,
  OverlayMetricsPlatformSchema,
  OverlayMetricsDevice,
  OverlayMetricsDeviceSchema,
  OverlayMetricsTransport,
  OverlayMetricsTransportSchema,
  OverlayMetricsSdk,
  OverlayMetricsSdkSchema,
  OverlayMetricsFailure,
  OverlayMetricsFailureSchema,
  OverlayMetricsTimeseries,
  OverlayMetricsTimeseriesSchema,
  OverlayMetricsLatency,
  OverlayMetricsLatencySchema,
} from './schemas';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: OverlayMetricsPlatform.name, schema: OverlayMetricsPlatformSchema },
      { name: OverlayMetricsDevice.name, schema: OverlayMetricsDeviceSchema },
      { name: OverlayMetricsTransport.name, schema: OverlayMetricsTransportSchema },
      { name: OverlayMetricsSdk.name, schema: OverlayMetricsSdkSchema },
      { name: OverlayMetricsFailure.name, schema: OverlayMetricsFailureSchema },
      { name: OverlayMetricsTimeseries.name, schema: OverlayMetricsTimeseriesSchema },
      { name: OverlayMetricsLatency.name, schema: OverlayMetricsLatencySchema },
    ]),
  ],
  providers: [LoaderService],
  exports: [LoaderService],
})
export class LoaderModule {}
```

### `src/modules/scheduler/scheduler.module.ts`

```typescript
import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { SchedulerService, OVERLAY_METRICS_QUEUE } from './scheduler.service';
import { OverlayMetricsProcessor } from './processors/overlay-metrics.processor';
import { ExtractorModule } from '@modules/extractor/extractor.module';
import { TransformerModule } from '@modules/transformer/transformer.module';
import { LoaderModule } from '@modules/loader/loader.module';

@Module({
  imports: [
    BullModule.registerQueue({ name: OVERLAY_METRICS_QUEUE }),
    ExtractorModule,
    TransformerModule,
    LoaderModule,
  ],
  providers: [SchedulerService, OverlayMetricsProcessor],
})
export class SchedulerModule {}
```

---

## 6. Environment Variables

Thêm vào `.env`:

```bash
# Elasticsearch Tracking
TRACKING_ES_NODE=http://localhost:9200
TRACKING_ES_INDEX=tracking-events-*
TRACKING_ES_USERNAME=
TRACKING_ES_PASSWORD=
TRACKING_ES_API_KEY=
TRACKING_ES_TIMEOUT_MS=10000

# MongoDB (đã có)
MONGO_URI=mongodb://localhost:27017/data_refinery

# Redis (đã có)
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=

# App
ELASTIC_APM_ENVIRONMENT=development
TZ=Asia/Ho_Chi_Minh
```

---

## 7. Migration từ Query ES trực tiếp sang MongoDB

### Bước 1: Backfill data

Chạy one-time job để extract historical data từ ES vào MongoDB:

```typescript
// migration/backfill-overlay-metrics.ts
const startDate = new Date('2024-01-01');
const endDate = new Date();
const intervalMinutes = 5;

for (let d = startDate; d < endDate; d = new Date(d.getTime() + intervalMinutes * 60000)) {
  await processor.runJob({
    timelineIds: await getAllTimelineIds(),
    tenantId: 'default',
    from: d,
    to: new Date(d.getTime() + intervalMinutes * 60000),
  });
}
```

### Bước 2: Dual-read (optional)

Trong giai đoạn transition, backend có thể:
1. Thử đọc từ MongoDB trước
2. Nếu không có data (cache miss), fallback sang ES
3. Log metric "cache hit/miss" để monitor

### Bước 3: Cutover

Khi MongoDB đã có đủ data, sửa API backend để:
- Xóa ES query logic
- Chỉ đọc từ MongoDB
- Trả về 404 nếu chưa có data (operator cần đợi vài phút)

---

## 8. Monitoring & Alerting

| Metric | Cách đo | Alert nếu |
|--------|---------|-----------|
| ETL latency | `intervalTo - processedAt` trong MongoDB | > 10 phút |
| ES query time | `took` field trong response | > 5 giây |
| Documents processed per job | Log hoặc MongoDB count | = 0 (không có data mới) |
| MongoDB bulkWrite errors | Catch exception | > 0 |
| API response time | Backend APM | > 100ms (p95) |
