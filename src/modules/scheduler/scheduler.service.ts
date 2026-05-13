import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Queue } from 'bullmq';
import { InjectQueue } from '@nestjs/bullmq';

@Injectable()
export class SchedulerService implements OnModuleInit {
  private readonly logger = new Logger(SchedulerService.name);

  constructor(
    @InjectQueue('data-refinery')
    private readonly dataRefineryQueue: Queue,
  ) {}

  async onModuleInit(): Promise<void> {
    // Idempotent scheduler registration using upsertJobScheduler
    await this.dataRefineryQueue.upsertJobScheduler(
      'apm-extract-every-5min',
      {
        every: 5 * 60 * 1000, // 5 minutes
      },
      {
        name: 'extract-transform-load',
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
