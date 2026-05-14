import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Kafka, Producer, Partitioners } from 'kafkajs';

export interface JobPayload {
  version?: number;
  jobType?: string;
  tenantId: string;
  matchId: string;
  timelineId: string;
  timeRangeMinutes: number;
  intervalFrom?: string;
  intervalTo?: string;
  retryCount?: number;
  origin?: 'scheduled' | 'backfill';
  scheduledAt?: string;
  correlationId?: string;
}

/**
 * Service đóng gói KafkaJS Producer.
 * Cung cấp sendJob vào topic chính và sendToDLQ cho message thất bại.
 */
@Injectable()
export class KafkaProducerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(KafkaProducerService.name);
  private readonly producer: Producer;

  constructor(private readonly configService: ConfigService) {
    const clientId = this.configService.get<string>('kafka.clientId')!;
    const brokers = this.configService.get<string[]>('kafka.brokers')!;
    const kafka = new Kafka({ clientId, brokers });
    this.producer = kafka.producer({
      createPartitioner: Partitioners.DefaultPartitioner,
    });
  }

  async onModuleInit(): Promise<void> {
    await this.producer.connect();
    this.logger.log('Kafka producer connected');
  }

  async onModuleDestroy(): Promise<void> {
    await this.producer.disconnect();
    this.logger.log('Kafka producer disconnected');
  }

  /**
   * Gửi job message vào topic overlay-metrics.etl.jobs.
   * Partition key được tính từ tenantId|matchId|timelineId để đảm bảo ordering.
   */
  async sendJob(payload: JobPayload): Promise<void> {
    const topic = 'overlay-metrics.etl.jobs';
    const key = `${payload.tenantId}|${payload.matchId}|${payload.timelineId}`;
    const value = JSON.stringify({
      version: 1,
      jobType: 'extract-transform-load-metrics',
      ...payload,
    });

    await this.producer.send({
      topic,
      messages: [{ key, value }],
    });

    this.logger.debug(`Produced job to ${topic}: ${key}`);
  }

  /**
   * Gửi message thất bại vào DLQ topic kèm thông tin lỗi.
   */
  async sendToDLQ(payload: JobPayload, error: Error): Promise<void> {
    const topic = this.configService.get<string>('kafka.dlqTopic')!;
    const value = JSON.stringify({
      ...payload,
      errorMessage: error.message,
      errorStack: error.stack,
      failedAt: new Date().toISOString(),
    });

    await this.producer.send({
      topic,
      messages: [{ value }],
    });

    this.logger.error(`Sent failed job to DLQ ${topic}: ${error.message}`);
  }
}
