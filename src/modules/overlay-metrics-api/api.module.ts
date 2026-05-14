import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { PersistenceModule } from '@infrastructure/persistence/persistence.module';
import { SchedulerModule } from '@modules/overlay-metrics-etl/scheduler/scheduler.module';
import { OVERLAY_METRICS_QUEUE } from '@common/constants/scheduler.constants';
import { MetricsApiController } from './metrics-api.controller';
import { MetricsApiService } from './metrics-api.service';

@Module({
  imports: [
    PersistenceModule,
    SchedulerModule,
    BullModule.registerQueue({
      name: OVERLAY_METRICS_QUEUE,
    }),
  ],
  controllers: [MetricsApiController],
  providers: [MetricsApiService],
})
export class ApiModule {}
