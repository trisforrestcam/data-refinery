import { Injectable, Logger } from '@nestjs/common';
import { ExtractorService } from '../extractor/extractor.service';
import { TransformerService } from '../transformer/transformer.service';
import { TransformContext } from '../interfaces/transform-context.interface';
import { LoaderService } from '../loader/loader.service';
import { JobPayload } from './kafka-producer.service';

/**
 * Service chạy 7 bước ETL cho 1 timeline cụ thể.
 * Được tách ra từ OverlayMetricsProcessor để dùng với Kafka consumer.
 * Mỗi timeline xử lý riêng biệt để tránh data từ timeline A ghi đè timeline B.
 * Nếu 1 bước fail, toàn bộ timeline throw để consumer quyết định retry hoặc DLQ.
 */
@Injectable()
export class TimelineProcessorService {
  private readonly logger = new Logger(TimelineProcessorService.name);

  constructor(
    private readonly extractor: ExtractorService,
    private readonly transformer: TransformerService,
    private readonly loader: LoaderService,
  ) {}

  /**
   * Validate và chạy pipeline 13 query + 7 transform/load cho 1 timeline.
   */
  async processTimeline(payload: JobPayload): Promise<void> {
    const validated = this.validatePayload(payload);
    if (!validated) {
      throw new Error(
        'Invalid timeline payload: missing tenantId, matchId, timelineId, or timeRangeMinutes',
      );
    }

    const { tenantId, matchId, timelineId } = validated;
    const { intervalFrom, intervalTo } = this.resolveInterval(validated);

    await this.executeTimelinePipeline(
      timelineId,
      matchId,
      tenantId,
      intervalFrom,
      intervalTo,
    );
  }

  /**
   * Validate payload đầu vào.
   * Payload mới luôn có explicit tenantId, matchId, timelineId.
   */
  private validatePayload(
    payload: JobPayload,
  ): (JobPayload & { intervalFrom: Date; intervalTo: Date }) | null {
    if (
      typeof payload.tenantId !== 'string' ||
      !payload.tenantId ||
      typeof payload.matchId !== 'string' ||
      !payload.matchId ||
      typeof payload.timelineId !== 'string' ||
      !payload.timelineId ||
      typeof payload.timeRangeMinutes !== 'number' ||
      !Number.isFinite(payload.timeRangeMinutes) ||
      payload.timeRangeMinutes <= 0
    ) {
      return null;
    }

    return payload as JobPayload & { intervalFrom: Date; intervalTo: Date };
  }

  /**
   * Parse date từ string hoặc Date object.
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
   * Ưu tiên explicit intervalFrom/intervalTo từ payload (backfill).
   * Nếu không có, tính từ thờ gian hiện tại round xuống bội số của timeRangeMinutes.
   */
  private resolveInterval(payload: JobPayload): {
    intervalFrom: Date;
    intervalTo: Date;
  } {
    const explicitFrom = this.parseOptionalDate(
      payload.intervalFrom,
      'intervalFrom',
    );
    const explicitTo = this.parseOptionalDate(payload.intervalTo, 'intervalTo');

    if (explicitFrom || explicitTo) {
      if (!explicitFrom || !explicitTo || explicitFrom >= explicitTo) {
        throw new Error(
          'intervalFrom and intervalTo must both be valid and ordered',
        );
      }
      return { intervalFrom: explicitFrom, intervalTo: explicitTo };
    }

    const intervalMs = payload.timeRangeMinutes * 60 * 1000;
    const nowMs = Date.now();
    const intervalTo = new Date(Math.floor(nowMs / intervalMs) * intervalMs);
    const intervalFrom = new Date(intervalTo.getTime() - intervalMs);

    return { intervalFrom, intervalTo };
  }

  /**
   * Chạy 7 bước ETL cho 1 timeline cụ thể.
   * Nếu 1 bước fail, throw ngay để consumer xử lý retry/DLQ.
   */
  private async executeTimelinePipeline(
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
      await this.loader.loadPlatformMetrics(ctx.tenantId, platformData);
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
        await this.loader.loadDeviceBreakdown(ctx.tenantId, deviceData);
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
      await this.loader.loadTransportComparison(ctx.tenantId, transportData);
      this.logger.log(
        `Timeline ${timelineId} - Transport comparison: ${transportData.length} items`,
      );

      const sdkAgg = await this.extractor.extractSdkVersions(query);
      const sdkData = this.transformer.transformSdkVersions(
        sdkAgg.aggregations,
        ctx,
      );
      await this.loader.loadSdkVersions(ctx.tenantId, sdkData);
      this.logger.log(
        `Timeline ${timelineId} - SDK versions: ${sdkData.length} items`,
      );

      const failureAgg = await this.extractor.extractFailures(query);
      const failureData = this.transformer.transformFailures(
        failureAgg.aggregations,
        ctx,
      );
      await this.loader.loadFailures(ctx.tenantId, failureData);
      this.logger.log(
        `Timeline ${timelineId} - Failures: ${failureData.length} items`,
      );

      const latencyAgg = await this.extractor.extractLatency(query);
      const latencyData = this.transformer.transformLatency(
        latencyAgg.aggregations,
        ctx,
      );
      await this.loader.loadLatency(ctx.tenantId, [latencyData]);
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
        await this.loader.loadTimeseries(ctx.tenantId, tsData);
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
