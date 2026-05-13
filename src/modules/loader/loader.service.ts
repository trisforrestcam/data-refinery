import { Injectable, Logger } from '@nestjs/common';
import { RefinedDataDto } from '@modules/transformer/dto/refined-data.dto';
import { ApmRecordRepository } from './repositories/apm-record.repository';

@Injectable()
export class LoaderService {
  private readonly logger = new Logger(LoaderService.name);

  constructor(private readonly apmRecordRepository: ApmRecordRepository) {}

  async loadBatch(data: RefinedDataDto[]): Promise<void> {
    if (data.length === 0) {
      this.logger.log('No data to load');
      return;
    }

    const operations = data.map((item) => ({
      insertOne: {
        document: {
          ...item,
          processed: true,
        },
      },
    }));

    await this.apmRecordRepository.bulkWrite(operations);
    this.logger.log(`Loaded ${data.length} records into MongoDB`);
  }
}
