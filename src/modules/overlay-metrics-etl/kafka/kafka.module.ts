import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { PipelinesModule } from '../pipelines/pipelines.module';
import kafkaConfig from '@config/kafka.config';
import {
  SchedulerTarget,
  SchedulerTargetSchema,
} from '@domain/schemas/scheduler-target.schema';
import { SchedulerConfigService } from '../scheduler/scheduler-config.service';
import { KafkaProducerService } from './kafka-producer.service';
import { KafkaConsumerService } from './kafka-consumer.service';
import { JobProducerService } from './job-producer.service';
import { TimelineProcessorService } from './timeline-processor.service';

/**
 * KafkaModule thay thế SchedulerModule trong ETL pipeline.
 * Cung cấp producer (cron + backfill), consumer, và timeline processor.
 * Import PipelinesModule để inject MetricPipeline[] vào TimelineProcessorService.
 */
@Module({
  imports: [
    ConfigModule.forFeature(kafkaConfig),
    MongooseModule.forFeature([
      { name: SchedulerTarget.name, schema: SchedulerTargetSchema },
    ]),
    PipelinesModule,
  ],
  providers: [
    SchedulerConfigService,
    KafkaProducerService,
    KafkaConsumerService,
    JobProducerService,
    TimelineProcessorService,
  ],
  exports: [
    SchedulerConfigService,
    KafkaProducerService,
    JobProducerService,
    TimelineProcessorService,
  ],
})
export class KafkaModule {}
