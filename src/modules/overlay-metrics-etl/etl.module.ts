import { Module } from '@nestjs/common';
import { PipelinesModule } from './pipelines/pipelines.module';
import { KafkaModule } from './kafka/kafka.module';

/**
 * ETL Module tổng hợp toàn bộ pipeline ETL cho overlay metrics.
 * Import PipelinesModule (chứa 7 metric strategies) và KafkaModule (scheduler + consumer).
 */
@Module({
  imports: [PipelinesModule, KafkaModule],
})
export class EtlModule {}
