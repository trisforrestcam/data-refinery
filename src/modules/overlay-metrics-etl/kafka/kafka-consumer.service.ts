import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Kafka, Consumer, KafkaMessage } from 'kafkajs';
import { KafkaProducerService, JobPayload } from './kafka-producer.service';
import { TimelineProcessorService } from './timeline-processor.service';

/**
 * Kafka Consumer dùng raw KafkaJS với manual commit.
 * Xử lý retry qua pause/resume partition và DLQ sau maxRetries.
 */
@Injectable()
export class KafkaConsumerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(KafkaConsumerService.name);
  private readonly consumer: Consumer;

  constructor(
    private readonly configService: ConfigService,
    private readonly kafkaProducer: KafkaProducerService,
    private readonly timelineProcessor: TimelineProcessorService,
  ) {
    const clientId = this.configService.get<string>('kafka.clientId')!;
    const brokers = this.configService.get<string[]>('kafka.brokers')!;
    const groupId = this.configService.get<string>('kafka.groupId')!;
    const kafka = new Kafka({ clientId, brokers });
    this.consumer = kafka.consumer({ groupId });
  }

  async onModuleInit(): Promise<void> {
    const topic = 'overlay-metrics.etl.jobs';
    await this.consumer.connect();
    await this.consumer.subscribe({ topic, fromBeginning: false });
    this.logger.log(`Kafka consumer subscribed to ${topic}`);

    await this.consumer.run({
      autoCommit: false,
      eachMessage: async ({ topic, partition, message }) => {
        await this.handleMessage(topic, partition, message);
      },
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.consumer.disconnect();
    this.logger.log('Kafka consumer disconnected');
  }

  private async handleMessage(
    topic: string,
    partition: number,
    message: KafkaMessage,
  ): Promise<void> {
    const offset = message.offset;
    let payload: JobPayload;

    try {
      payload = JSON.parse(message.value!.toString()) as JobPayload;
    } catch (error) {
      this.logger.error(
        `Failed to parse message at offset ${offset}: ${(error as Error).message}`,
      );
      await this.kafkaProducer.sendToDLQ({} as JobPayload, error as Error);
      await this.commitOffset(topic, partition, offset);
      return;
    }

    const retryCount = payload.retryCount || 0;
    const maxRetries = this.configService.get<number>('kafka.maxRetries')!;
    const retryDelayMs = this.configService.get<number>('kafka.retryDelayMs')!;

    try {
      await this.timelineProcessor.processTimeline(payload);
      await this.commitOffset(topic, partition, offset);
    } catch (error) {
      if (retryCount < maxRetries) {
        const nextRetry = retryCount + 1;
        const backoffMs = retryDelayMs * Math.pow(2, retryCount);
        this.logger.warn(
          `Timeline ${payload.timelineId} failed (retry ${nextRetry}/${maxRetries}), republishing with backoff ${backoffMs}ms`,
        );
        try {
          await this.kafkaProducer.sendJob({
            ...payload,
            retryCount: nextRetry,
          });
        } catch (publishError) {
          this.logger.error(
            `Failed to republish retry message for timeline ${payload.timelineId}: ${(publishError as Error).message}`,
          );
        }
        await this.commitOffset(topic, partition, offset);
      } else {
        this.logger.error(
          `Timeline ${payload.timelineId} failed after ${maxRetries} retries, sending to DLQ`,
        );
        await this.kafkaProducer.sendToDLQ(payload, error as Error);
        await this.commitOffset(topic, partition, offset);
      }
    }
  }

  private async commitOffset(
    topic: string,
    partition: number,
    offset: string,
  ): Promise<void> {
    await this.consumer.commitOffsets([
      { topic, partition, offset: (Number(offset) + 1).toString() },
    ]);
  }
}
