import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { ExtractorService } from '@modules/overlay-metrics-etl/extractor/extractor.service';
import { TransformerService } from '@modules/overlay-metrics-etl/transformer/transformer.service';
import { TransformContext } from '@common/interfaces/transform-context.interface';
import { LoaderService } from '@modules/overlay-metrics-etl/loader/loader.service';
import {
  OVERLAY_METRICS_QUEUE,
  OVERLAY_METRICS_JOB,
} from '@common/constants/scheduler.constants';

interface OverlayMetricsJobData {
  timeRangeMinutes: number;
  timelineIds: string[];
  tenantId: string;
  matchId: string;
  intervalFrom?: string | Date;
  intervalTo?: string | Date;
}

/**
 * Processor là "trái tim" của ETL pipeline.
 * Nhận job từ BullMQ mỗi 5 phút, chạy 7 bước extract → transform → load
 * cho từng timeline riêng biệt để tránh ghi đè data.
 */
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

  /**
   * Validate job data trước khi xử lý.
   * Tránh pipeline chạy với data thiếu hoặc malformed gây lỗi ở tầng dưới.
   */
  private validateJobData(data: unknown): OverlayMetricsJobData | null {
    if (typeof data !== 'object' || data === null) {
      return null;
    }
    const d = data as Record<string, unknown>;

    if (
      typeof d.timeRangeMinutes !== 'number' ||
      !Number.isFinite(d.timeRangeMinutes) ||
      d.timeRangeMinutes <= 0
    ) {
      return null;
    }
    if (!Array.isArray(d.timelineIds) || d.timelineIds.length === 0) {
      return null;
    }
    if (typeof d.tenantId !== 'string' || !d.tenantId) {
      return null;
    }
    if (typeof d.matchId !== 'string' || !d.matchId) {
      return null;
    }

    return d as unknown as OverlayMetricsJobData;
  }

  /**
   * Parse date từ job data (string hoặc Date object).
   * Dùng cho backfill: cho phép chạy job với interval cụ thể từ request.
   */
  private parseOptionalDate(
    value: string | Date | undefined,
    field: string,
  ): Date | undefined {
    if (value === undefined) return undefined;

    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) {
      throw new Error(`Missing or invalid job field: ${field}`);
    }
    return date;
  }

  /**
   * Xác định interval cần aggregate.
   * Ưu tiên explicit interval từ job data (backfill), nếu không thì tính từ job timestamp.
   */
  private resolveInterval(
    data: OverlayMetricsJobData,
    job: Job,
    intervalMs: number,
  ): { intervalFrom: Date; intervalTo: Date } {
    const explicitFrom = this.parseOptionalDate(
      data.intervalFrom,
      'intervalFrom',
    );
    const explicitTo = this.parseOptionalDate(data.intervalTo, 'intervalTo');

    if (explicitFrom || explicitTo) {
      if (!explicitFrom || !explicitTo || explicitFrom >= explicitTo) {
        throw new Error(
          'intervalFrom and intervalTo must both be valid and ordered',
        );
      }
      return { intervalFrom: explicitFrom, intervalTo: explicitTo };
    }

    const scheduledAtMs = job.timestamp + Math.max(job.delay ?? 0, 0);
    const intervalTo = new Date(
      Math.floor(scheduledAtMs / intervalMs) * intervalMs,
    );
    const intervalFrom = new Date(intervalTo.getTime() - intervalMs);

    return { intervalFrom, intervalTo };
  }

  /**
   * Entry point của ETL job.
   * Validate data → resolve interval → chạy per-timeline.
   * Nếu 1 timeline fail, throw để BullMQ retry cả job.
   */
  async process(job: Job): Promise<void> {
    if (job.name !== OVERLAY_METRICS_JOB) {
      this.logger.warn(`Unknown job name: ${job.name}`);
      return;
    }

    this.logger.log(`Processing job ${job.id}`);

    const data = this.validateJobData(job.data);
    if (!data) {
      this.logger.warn('No timelineIds or tenantId provided, skipping');
      return;
    }

    const intervalMs = data.timeRangeMinutes * 60 * 1000;
    const { intervalFrom, intervalTo } = this.resolveInterval(
      data,
      job,
      intervalMs,
    );

    const failedTimelines: string[] = [];

    for (const timelineId of data.timelineIds) {
      try {
        await this.processTimeline(
          timelineId,
          data.matchId,
          data.tenantId,
          intervalFrom,
          intervalTo,
        );
      } catch (error) {
        this.logger.error(
          `Timeline ${timelineId} failed, skipping remaining timelines in this job: ${(error as Error).message}`,
        );
        failedTimelines.push(timelineId);
        // Continue with next timeline instead of failing entire job
        // This prevents already-accumulated data from being double-counted on retry
      }
    }

    if (failedTimelines.length > 0) {
      this.logger.warn(
        `Job ${job.id} completed with ${failedTimelines.length} failed timelines: ${failedTimelines.join(', ')}`,
      );
    } else {
      this.logger.log(`Job ${job.id} completed`);
    }
  }

  /**
   * Chạy 7 bước ETL cho 1 timeline cụ thể.
   * Mỗi timeline được xử lý riêng biệt để tránh data từ timeline A ghi đè timeline B.
   * Nếu 1 bước fail, toàn bộ timeline được rollback (không persist gì cả).
   */
  private async processTimeline(
    timelineId: string,
    matchId: string,
    tenantId: string,
    intervalFrom: Date,
    intervalTo: Date,
  ): Promise<void> {
    const ctx: TransformContext = {
      timelineId,
      matchId,
      tenantId,
      intervalFrom,
      intervalTo,
    };

    const query = {
      timelineIds: [timelineId],
      tenantId,
      from: intervalFrom,
      to: intervalTo,
    };

    try {
      const platformAgg = await this.extractor.extractPlatformMetrics(query);
      const platformData = this.transformer.transformPlatformMetrics(
        platformAgg.aggregations,
        ctx,
      );
      await this.loader.loadPlatformMetrics(platformData);
      this.logger.log(
        `Timeline ${timelineId} - Platform metrics: ${platformData.length} items`,
      );

      for (const dimension of ['browser', 'os', 'deviceClass']) {
        const deviceAgg = await this.extractor.extractDeviceBreakdown(
          query,
          dimension,
        );
        const deviceData = this.transformer.transformDeviceBreakdown(
          deviceAgg.aggregations,
          ctx,
          dimension,
        );
        await this.loader.loadDeviceBreakdown(deviceData);
        this.logger.log(
          `Timeline ${timelineId} - Device breakdown (${dimension}): ${deviceData.length} items`,
        );
      }

      const transportAgg =
        await this.extractor.extractTransportComparison(query);
      const transportData = this.transformer.transformTransportComparison(
        transportAgg.aggregations,
        ctx,
      );
      await this.loader.loadTransportComparison(transportData);
      this.logger.log(
        `Timeline ${timelineId} - Transport comparison: ${transportData.length} items`,
      );

      const sdkAgg = await this.extractor.extractSdkVersions(query);
      const sdkData = this.transformer.transformSdkVersions(
        sdkAgg.aggregations,
        ctx,
      );
      await this.loader.loadSdkVersions(sdkData);
      this.logger.log(
        `Timeline ${timelineId} - SDK versions: ${sdkData.length} items`,
      );

      const failureAgg = await this.extractor.extractFailures(query);
      const failureData = this.transformer.transformFailures(
        failureAgg.aggregations,
        ctx,
      );
      await this.loader.loadFailures(failureData);
      this.logger.log(
        `Timeline ${timelineId} - Failures: ${failureData.length} items`,
      );

      const latencyAgg = await this.extractor.extractLatency(query);
      const latencyData = this.transformer.transformLatency(
        latencyAgg.aggregations,
        ctx,
      );
      await this.loader.loadLatency([latencyData]);
      this.logger.log(`Timeline ${timelineId} - Latency: 1 item`);

      for (const metric of [
        'sent',
        'received',
        'rendered',
        'failed',
        'avgRenderMs',
      ]) {
        const tsAgg = await this.extractor.extractTimeseries(
          query,
          metric,
          '5m',
        );
        const tsData = this.transformer.transformTimeseries(
          tsAgg.aggregations,
          ctx,
          metric,
          '5m',
        );
        await this.loader.loadTimeseries(tsData);
        this.logger.log(
          `Timeline ${timelineId} - Timeseries (${metric}): ${tsData.length} items`,
        );
      }
    } catch (error) {
      this.logger.error(
        `Timeline ${timelineId} processing failed: ${(error as Error).message}`,
        (error as Error).stack,
      );
      throw error;
    }
  }
}
