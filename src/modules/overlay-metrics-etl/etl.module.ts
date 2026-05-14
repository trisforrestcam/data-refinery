import { Module } from '@nestjs/common';
import { ExtractorModule } from './extractor/extractor.module';
import { TransformerModule } from './transformer/transformer.module';
import { LoaderModule } from './loader/loader.module';
import { SchedulerModule } from './scheduler/scheduler.module';

@Module({
  imports: [ExtractorModule, TransformerModule, LoaderModule, SchedulerModule],
})
export class EtlModule {}
