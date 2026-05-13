import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Queue } from 'bullmq';
import { InjectQueue } from '@nestjs/bullmq';
import {
  APM_EXTRACT_SCHEDULER_ID,
  DATA_REFINERY_QUEUE,
  EXTRACT_TRANSFORM_LOAD_JOB,
} from '@common/constants/scheduler.constants';

@Injectable()
export class SchedulerService implements OnModuleInit {
  private readonly logger = new Logger(SchedulerService.name);

  constructor(
    @InjectQueue(DATA_REFINERY_QUEUE)
    private readonly dataRefineryQueue: Queue,
  ) {}

  async onModuleInit(): Promise<void> {
    // Idempotent scheduler registration using upsertJobScheduler
    await this.dataRefineryQueue.upsertJobScheduler(
      APM_EXTRACT_SCHEDULER_ID,
      {
        every: 5 * 60 * 1000, // 5 minutes
      },
      {
        name: EXTRACT_TRANSFORM_LOAD_JOB,
        data: {
          timeRangeMinutes: 5,
        },
        opts: {
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 5000,
          },
        },
      },
    );

    this.logger.log('APM extract scheduler registered (every 5 minutes)');
  }
}
