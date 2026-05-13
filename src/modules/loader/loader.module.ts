import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { LoaderService } from './loader.service';
import { ApmRecord, ApmRecordSchema } from './schemas/apm-record.schema';
import { ApmRecordRepository } from './repositories/apm-record.repository';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ApmRecord.name, schema: ApmRecordSchema },
    ]),
  ],
  providers: [LoaderService, ApmRecordRepository],
  exports: [LoaderService],
})
export class LoaderModule {}
