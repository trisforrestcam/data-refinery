import { Module } from '@nestjs/common';
import { ExtractorModule } from './extractor/extractor.module';
import { TransformerModule } from './transformer/transformer.module';
import { LoaderModule } from './loader/loader.module';
import { KafkaModule } from './kafka/kafka.module';

@Module({
  imports: [ExtractorModule, TransformerModule, LoaderModule, KafkaModule],
})
export class EtlModule {}
