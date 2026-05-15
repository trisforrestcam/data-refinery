import { Module } from '@nestjs/common';
import { RealtimeController } from './realtime.controller';
import { RealtimeService } from './realtime.service';
import { ExtractorModule } from '@modules/overlay-metrics-etl/extractor/extractor.module';
import { TransformerModule } from '@modules/overlay-metrics-etl/transformer/transformer.module';

@Module({
  imports: [ExtractorModule, TransformerModule],
  controllers: [RealtimeController],
  providers: [RealtimeService],
})
export class RealtimeModule {}
