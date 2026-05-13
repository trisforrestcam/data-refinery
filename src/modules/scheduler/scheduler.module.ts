import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { SchedulerService } from './scheduler.service';
import { DataRefineryProcessor } from './processors/data-refinery.processor';
import { ExtractorModule } from '@modules/extractor/extractor.module';
import { TransformerModule } from '@modules/transformer/transformer.module';
import { LoaderModule } from '@modules/loader/loader.module';

@Module({
  imports: [
    BullModule.registerQueue({
      name: 'data-refinery',
    }),
    ExtractorModule,
    TransformerModule,
    LoaderModule,
  ],
  providers: [SchedulerService, DataRefineryProcessor],
})
export class SchedulerModule {}
