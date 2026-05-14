import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Queue } from 'bullmq';
import { InjectQueue } from '@nestjs/bullmq';
import {
  OVERLAY_METRICS_QUEUE,
  OVERLAY_METRICS_SCHEDULER_ID,
  OVERLAY_METRICS_JOB,
} from '@common/constants/scheduler.constants';

/**
 * Scheduler đăng ký job chạy định kỳ mỗi 5 phút qua BullMQ.
 * Job data bao gồm tenantId, matchId, timelineIds để processor biết phải aggregate cho ai.
 * Nếu thiếu env vars, scheduler sẽ không đăng ký và log warning.
 */
@Injectable()
export class SchedulerService implements OnModuleInit {
  private readonly logger = new Logger(SchedulerService.name);

  constructor(
    @InjectQueue(OVERLAY_METRICS_QUEUE)
    private readonly queue: Queue,
  ) {}

  /**
   * Đăng ký upsertJobScheduler khi module khởi động.
   * Job sẽ tự động chạy mỗi 5 phút và retry 3 lần nếu fail.
   */
  async onModuleInit(): Promise<void> {
    const tenantId = process.env.OVERLAY_METRICS_TENANT_ID;
    const matchId = process.env.OVERLAY_METRICS_MATCH_ID;
    const timelineIds = process.env.OVERLAY_METRICS_TIMELINE_IDS
      ? process.env.OVERLAY_METRICS_TIMELINE_IDS.split(',').map((s) => s.trim())
      : [];

    if (!tenantId || !matchId || timelineIds.length === 0) {
      this.logger.warn(
        'Overlay metrics scheduler missing required env vars: OVERLAY_METRICS_TENANT_ID, OVERLAY_METRICS_MATCH_ID, OVERLAY_METRICS_TIMELINE_IDS. Scheduler will not be registered.',
      );
      return;
    }

    await this.queue.upsertJobScheduler(
      OVERLAY_METRICS_SCHEDULER_ID,
      { every: 5 * 60 * 1000 }, // 5 minutes
      {
        name: OVERLAY_METRICS_JOB,
        data: { timeRangeMinutes: 5, tenantId, matchId, timelineIds },
        opts: {
          attempts: 3,
          backoff: { type: 'exponential', delay: 5000 },
        },
      },
    );

    this.logger.log('Overlay metrics scheduler registered (every 5 minutes)');
  }
}
