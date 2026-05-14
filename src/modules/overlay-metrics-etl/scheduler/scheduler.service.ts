import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Queue } from 'bullmq';
import { InjectQueue } from '@nestjs/bullmq';
import {
  OVERLAY_METRICS_QUEUE,
  OVERLAY_METRICS_SCHEDULER_ID,
  OVERLAY_METRICS_JOB,
} from '@common/constants/scheduler.constants';
import { SchedulerConfigService } from './scheduler-config.service';

/**
 * Scheduler đăng ký job chạy định kỳ mỗi 5 phút qua BullMQ.
 * Job data bao gồm danh sách targets (tenantId, matchId, timelineIds) để processor biết phải aggregate cho ai.
 * Hỗ trợ nhiều match đồng thờ bằng cách enqueue nhiều job — mỗi job cho 1 target.
 * Nếu không có target nào active, scheduler sẽ không đăng ký và log warning.
 */
@Injectable()
export class SchedulerService implements OnModuleInit {
  private readonly logger = new Logger(SchedulerService.name);

  constructor(
    @InjectQueue(OVERLAY_METRICS_QUEUE)
    private readonly queue: Queue,
    private readonly configService: SchedulerConfigService,
  ) {}

  /**
   * Đăng ký upsertJobScheduler khi module khởi động.
   * Job sẽ tự động chạy mỗi 5 phút và retry 3 lần nếu fail.
   * Mỗi lần chạy, enqueue 1 job cho mỗi active target.
   */
  async onModuleInit(): Promise<void> {
    const targets = await this.configService.getActiveTargets();

    if (targets.length === 0) {
      this.logger.warn(
        'Overlay metrics scheduler: no active targets found. Scheduler will not be registered. Set env vars (OVERLAY_METRICS_TENANT_ID, OVERLAY_METRICS_MATCH_ID, OVERLAY_METRICS_TIMELINE_IDS) or add targets via API.',
      );
      return;
    }

    await this.queue.upsertJobScheduler(
      OVERLAY_METRICS_SCHEDULER_ID,
      { every: 60 * 60 * 1000 }, // 1 hour
      {
        name: OVERLAY_METRICS_JOB,
        data: { timeRangeMinutes: 60, targets },
        opts: {
          attempts: 3,
          backoff: { type: 'exponential', delay: 5000 },
        },
      },
    );

    this.logger.log(
      `Overlay metrics scheduler registered (every 1 hour) with ${targets.length} target(s): ${targets.map((t) => t.matchId).join(', ')}`,
    );
  }
}
