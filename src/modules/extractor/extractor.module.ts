import { Module } from '@nestjs/common';
import { ExtractorService } from './extractor.service';
import { ApmElasticsearchService } from './elasticsearch/apm-elasticsearch.service';

@Module({
  providers: [ExtractorService, ApmElasticsearchService],
  exports: [ExtractorService],
})
export class ExtractorModule {}
