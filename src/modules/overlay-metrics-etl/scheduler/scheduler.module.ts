import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { BullModule } from '@nestjs/bullmq';
import { OVERLAY_METRICS_QUEUE } from '@common/constants/scheduler.constants';
import { SchedulerService } from './scheduler.service';
import { SchedulerConfigService } from './scheduler-config.service';
import { OverlayMetricsProcessor } from './processors/overlay-metrics.processor';
import { ExtractorModule } from '@modules/overlay-metrics-etl/extractor/extractor.module';
import { TransformerModule } from '@modules/overlay-metrics-etl/transformer/transformer.module';
import { LoaderModule } from '@modules/overlay-metrics-etl/loader/loader.module';
import {
  SchedulerTarget,
  SchedulerTargetSchema,
} from './schemas/scheduler-target.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: SchedulerTarget.name, schema: SchedulerTargetSchema },
    ]),
    BullModule.registerQueue({
      name: OVERLAY_METRICS_QUEUE,
    }),
    ExtractorModule,
    TransformerModule,
    LoaderModule,
  ],
  providers: [SchedulerService, SchedulerConfigService, OverlayMetricsProcessor],
  exports: [SchedulerConfigService],
})
export class SchedulerModule {}
