import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { randomUUID } from 'crypto';
import { SchedulerConfigService } from '../scheduler/scheduler-config.service';
import { KafkaProducerService } from './kafka-producer.service';
import { BackfillJobDto } from '@modules/overlay-metrics-api/dto/backfill-job.dto';

/**
 * JobProducerService thay thế SchedulerService.
 * Dùng @Cron chạy mỗi giờ và triggerBackfill cho API.
 * Mỗi timeline được produce thành 1 message riêng biệt.
 */
@Injectable()
export class JobProducerService {
  private readonly logger = new Logger(JobProducerService.name);

  constructor(
    private readonly schedulerConfig: SchedulerConfigService,
    private readonly kafkaProducer: KafkaProducerService,
  ) {}

  /**
   * Cron chạy mỗi giờ (phút 0).
   * Đọc active targets và produce 1 message / timeline vào Kafka topic.
   */
  @Cron('0 * * * *')
  async handleCron(): Promise<void> {
    const targets = await this.schedulerConfig.getActiveTargets();

    if (targets.length === 0) {
      this.logger.warn(
        'Overlay metrics scheduler: no active targets found. Cron will not produce messages. Add targets via API or DB.',
      );
      return;
    }

    for (const target of targets) {
      for (const timelineId of target.timelineIds) {
        try {
          await this.kafkaProducer.sendJob({
            tenantId: target.tenantId,
            matchId: target.matchId,
            timelineId,
            timeRangeMinutes: 60,
            retryCount: 0,
            origin: 'scheduled',
            scheduledAt: new Date().toISOString(),
          });
        } catch (error) {
          this.logger.error(
            `Failed to produce job for target ${target.matchId} timeline ${timelineId}: ${(error as Error).message}`,
          );
        }
      }
    }

    const totalMessages = targets.reduce(
      (sum, t) => sum + t.timelineIds.length,
      0,
    );
    this.logger.log(
      `Cron produced ${totalMessages} message(s) for ${targets.length} target(s)`,
    );
  }

  /**
   * Trigger backfill qua Kafka producer.
   * Mỗi timeline trong dto được publish thành 1 message với origin='backfill'.
   */
  async triggerBackfill(
    tenantId: string,
    dto: BackfillJobDto,
  ): Promise<{ status: string; correlationId: string }> {
    if (dto.tenantId !== tenantId) {
      throw new Error('Backfill tenantId does not match authenticated tenant');
    }

    const correlationId = randomUUID();

    for (const timelineId of dto.timelineIds) {
      try {
        await this.kafkaProducer.sendJob({
          tenantId: dto.tenantId,
          matchId: dto.matchId,
          timelineId,
          timeRangeMinutes: dto.timeRangeMinutes ?? 5,
          intervalFrom: dto.intervalFrom,
          intervalTo: dto.intervalTo,
          retryCount: 0,
          origin: 'backfill',
          correlationId,
        });
      } catch (error) {
        this.logger.error(
          `Failed to produce backfill job for match ${dto.matchId} timeline ${timelineId}: ${(error as Error).message}`,
        );
        throw error;
      }
    }

    this.logger.log(
      `Backfill published for match ${dto.matchId} with ${dto.timelineIds.length} timeline(s)`,
    );

    return { status: 'published', correlationId };
  }
}
