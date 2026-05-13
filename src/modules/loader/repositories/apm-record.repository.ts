import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { BaseRepository } from '@common/repositories/base.repository';
import { ApmRecord, ApmRecordDocument } from '../schemas/apm-record.schema';

@Injectable()
export class ApmRecordRepository extends BaseRepository<ApmRecordDocument> {
  constructor(
    @InjectModel(ApmRecord.name)
    private readonly apmRecordModel: Model<ApmRecordDocument>,
  ) {
    super(apmRecordModel);
  }
}
