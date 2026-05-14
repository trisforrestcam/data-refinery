import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { OVERLAY_METRICS_QUEUE } from '@common/constants/scheduler.constants';
import { SchedulerService } from './scheduler.service';
import { OverlayMetricsProcessor } from './processors/overlay-metrics.processor';
import { ExtractorModule } from '@modules/overlay-metrics-etl/extractor/extractor.module';
import { TransformerModule } from '@modules/overlay-metrics-etl/transformer/transformer.module';
import { LoaderModule } from '@modules/overlay-metrics-etl/loader/loader.module';

@Module({
  imports: [
    BullModule.registerQueue({
      name: OVERLAY_METRICS_QUEUE,
    }),
    ExtractorModule,
    TransformerModule,
    LoaderModule,
  ],
  providers: [SchedulerService, OverlayMetricsProcessor],
})
export class SchedulerModule {}
