import { Injectable } from '@nestjs/common';
import { ApmElasticsearchService } from './elasticsearch/apm-elasticsearch.service';
import { ApmQueryDto } from './dto/apm-query.dto';

@Injectable()
export class ExtractorService {
  constructor(private readonly elasticsearchService: ApmElasticsearchService) {}

  async extract(query: ApmQueryDto): Promise<any[]> {
    return this.elasticsearchService.searchApmTraces(query);
  }
}
