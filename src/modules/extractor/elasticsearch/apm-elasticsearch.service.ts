import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ElasticsearchService as BaseEsService } from '@nestjs/elasticsearch';
import { ApmQueryDto } from '../dto/apm-query.dto';

@Injectable()
export class ApmElasticsearchService {
  private readonly logger = new Logger(ApmElasticsearchService.name);

  constructor(
    private readonly esService: BaseEsService,
    private readonly configService: ConfigService,
  ) {}

  async searchApmTraces(query: ApmQueryDto): Promise<any[]> {
    const index =
      query.index || this.configService.get<string>('elasticsearch.apmIndex');
    const size = query.size || 1000;

    const must: any[] = [
      {
        range: {
          '@timestamp': {
            gte: query.from.toISOString(),
            lte: query.to.toISOString(),
          },
        },
      },
    ];

    if (query.serviceName) {
      must.push({ term: { 'service.name': query.serviceName } });
    }
    if (query.transactionType) {
      must.push({ term: { 'transaction.type': query.transactionType } });
    }

    try {
      const result = await this.esService.search({
        index,
        size,
        query: { bool: { must } },
        sort: [{ '@timestamp': { order: 'asc' } }],
      });

      return result.hits.hits.map((hit: any) => hit._source);
    } catch (error) {
      this.logger.error('Failed to search APM traces', error);
      throw error;
    }
  }
}
