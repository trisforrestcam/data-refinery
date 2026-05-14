import { Module } from '@nestjs/common';
import { ExtractorService } from './extractor.service';
import { TrackingEsService } from './elasticsearch/tracking-es.service';

@Module({
  providers: [ExtractorService, TrackingEsService],
  exports: [ExtractorService],
})
export class ExtractorModule {}
