import { Processor, WorkerHost } from '@nestjs/bullmq';
import {
  DATA_REFINERY_QUEUE,
  EXTRACT_TRANSFORM_LOAD_JOB,
} from '@common/constants/scheduler.constants';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { ExtractorService } from '@modules/extractor/extractor.service';
import { TransformerService } from '@modules/transformer/transformer.service';
import { LoaderService } from '@modules/loader/loader.service';

@Processor(DATA_REFINERY_QUEUE)
export class DataRefineryProcessor extends WorkerHost {
  private readonly logger = new Logger(DataRefineryProcessor.name);

  constructor(
    private readonly extractorService: ExtractorService,
    private readonly transformerService: TransformerService,
    private readonly loaderService: LoaderService,
  ) {
    super();
  }

  async process(job: Job): Promise<void> {
    if (job.name !== EXTRACT_TRANSFORM_LOAD_JOB) {
      this.logger.warn(`Unknown job name: ${job.name}`);
      return;
    }

    this.logger.log(
      `Processing job ${job.id} - extracting last ${job.data.timeRangeMinutes} minutes`,
    );

    const now = new Date();
    const from = new Date(
      now.getTime() - job.data.timeRangeMinutes * 60 * 1000,
    );

    // Extract
    const rawData = await this.extractorService.extract({
      from,
      to: now,
      size: 5000,
    });

    this.logger.log(`Extracted ${rawData.length} raw records`);

    // Transform
    const refinedData = this.transformerService.transform(rawData);

    // Load
    await this.loaderService.loadBatch(refinedData);

    this.logger.log(`Job ${job.id} completed`);
  }
}
