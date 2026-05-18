import { Injectable, Logger, Inject } from '@nestjs/common';
import { MetricPipeline } from '@modules/overlay-metrics-etl/pipelines/metric-pipeline.interface';
import { PipelineContext } from '@modules/overlay-metrics-etl/pipelines/pipeline.context';
import { METRIC_PIPELINES } from '@modules/overlay-metrics-etl/pipelines/pipelines.module';
import { JobPayload } from './kafka-producer.service';

/**
 * Service chạy ETL pipeline cho 1 timeline cụ thể.
 * Dùng Strategy Pattern — inject toàn bộ `MetricPipeline[]` và chạy song song.
 * Mỗi timeline xử lý riêng biệt để tránh data từ timeline A ghi đè timeline B.
 * Nếu 1 pipeline fail, các pipeline khác vẫn chạy xong rồi throw tổng hợp.
 */
@Injectable()
export class TimelineProcessorService {
  private readonly logger = new Logger(TimelineProcessorService.name);

  constructor(
    @Inject(METRIC_PIPELINES)
    private readonly pipelines: MetricPipeline[],
  ) {}

  /**
   * Validate và chạy tất cả metric pipelines cho 1 timeline.
   * Các pipeline chạy song song qua `Promise.all` để giảm tổng thờ gian xử lý.
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
   * Chạy tất cả metric pipelines song song cho 1 timeline.
   * Mỗi pipeline tự quản lý extract → transform → load riêng.
   * Error isolation: 1 pipeline fail không crash pipeline khác,
   * nhưng cuối cùng throw nếu có bất kỳ pipeline nào fail.
   */
  private async executeTimelinePipeline(
    timelineId: string,
    matchId: string,
    tenantId: string,
    intervalFrom: Date,
    intervalTo: Date,
  ): Promise<void> {
    const ctx: PipelineContext = {
      tenantId,
      matchId,
      timelineId,
      intervalFrom,
      intervalTo,
      query: {
        timelineIds: [timelineId],
        tenantId,
        mediaContentId: matchId,
        from: intervalFrom,
        to: intervalTo,
      },
    };

    const failedPipelines: string[] = [];

    await Promise.all(
      this.pipelines.map((pipeline) =>
        pipeline.execute(ctx).catch((error) => {
          const message =
            error instanceof Error ? error.message : String(error);
          this.logger.error(
            `Pipeline ${pipeline.type} failed for timeline ${timelineId}: ${message}`,
          );
          failedPipelines.push(pipeline.type);
        }),
      ),
    );

    if (failedPipelines.length > 0) {
      throw new Error(
        `Timeline ${timelineId} failed pipelines: ${failedPipelines.join(', ')}`,
      );
    }

    this.logger.log(
      `Timeline ${timelineId} — all ${this.pipelines.length} pipelines completed`,
    );
  }
}
