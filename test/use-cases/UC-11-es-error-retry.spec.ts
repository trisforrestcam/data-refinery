import { Logger } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { KafkaConsumerService } from '@modules/overlay-metrics-etl/kafka/kafka-consumer.service';
import {
  KafkaProducerService,
  JobPayload,
} from '@modules/overlay-metrics-etl/kafka/kafka-producer.service';
import { TimelineProcessorService } from '@modules/overlay-metrics-etl/kafka/timeline-processor.service';

// ---------------------------------------------------------------------------
// Mock kafkajs trước khi module load
// ---------------------------------------------------------------------------

const pauseMock = jest.fn();
const resumeMock = jest.fn();
const commitOffsetsMock = jest.fn().mockResolvedValue(undefined);
const connectMock = jest.fn().mockResolvedValue(undefined);
const subscribeMock = jest.fn().mockResolvedValue(undefined);
const runMock = jest.fn().mockResolvedValue(undefined);
const disconnectMock = jest.fn().mockResolvedValue(undefined);

let capturedEachMessage:
  | ((payload: {
      topic: string;
      partition: number;
      message: { offset: string; value: Buffer | null; key: Buffer | null };
    }) => Promise<void>)
  | undefined;

runMock.mockImplementation(
  ({ eachMessage }: { eachMessage: typeof capturedEachMessage }) => {
    capturedEachMessage = eachMessage;
  },
);

const mockConsumer = {
  connect: connectMock,
  subscribe: subscribeMock,
  run: runMock,
  pause: pauseMock,
  resume: resumeMock,
  commitOffsets: commitOffsetsMock,
  disconnect: disconnectMock,
};

jest.mock('kafkajs', () => ({
  Kafka: jest.fn().mockImplementation(() => ({
    consumer: jest.fn().mockReturnValue(mockConsumer),
  })),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

describe('UC-11 - Elasticsearch connection error retry qua Kafka consumer', () => {
  const tenantId = 'tenant-es-001';
  const matchId = 'match-es-001';
  const timelineId = 'timeline-es-001';

  const createPayload = (overrides?: Partial<JobPayload>): JobPayload => ({
    version: 1,
    jobType: 'extract-transform-load-metrics',
    tenantId,
    matchId,
    timelineId,
    timeRangeMinutes: 60,
    origin: 'scheduled',
    ...overrides,
  });

  const createMockConfigService = () => ({
    get: jest.fn((key: string) => {
      const map: Record<string, unknown> = {
        'kafka.clientId': 'data-refinery-test',
        'kafka.brokers': ['localhost:9092'],
        'kafka.groupId': 'test-consumers',
        'kafka.maxRetries': 3,
        'kafka.retryDelayMs': 5000,
      };
      return map[key];
    }),
  });

  describe('KafkaConsumerService retry flow', () => {
    let moduleRef: TestingModule;
    let timelineProcessor: { processTimeline: jest.Mock };
    let kafkaProducer: { sendJob: jest.Mock; sendToDLQ: jest.Mock };
    let logSpy: jest.SpyInstance;
    let errorSpy: jest.SpyInstance;

    beforeEach(async () => {
      timelineProcessor = {
        processTimeline: jest.fn().mockResolvedValue(undefined),
      };
      kafkaProducer = {
        sendJob: jest.fn().mockResolvedValue(undefined),
        sendToDLQ: jest.fn().mockResolvedValue(undefined),
      };

      logSpy = jest
        .spyOn(Logger.prototype, 'log')
        .mockImplementation(() => undefined);
      errorSpy = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined);
      jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);

      pauseMock.mockClear();
      resumeMock.mockClear();
      commitOffsetsMock.mockClear();
      connectMock.mockClear();
      subscribeMock.mockClear();
      runMock.mockClear();
      disconnectMock.mockClear();
      capturedEachMessage = undefined;

      moduleRef = await Test.createTestingModule({
        providers: [
          KafkaConsumerService,
          { provide: ConfigService, useValue: createMockConfigService() },
          { provide: KafkaProducerService, useValue: kafkaProducer },
          { provide: TimelineProcessorService, useValue: timelineProcessor },
        ],
      }).compile();

      const kafkaConsumerService = moduleRef.get(KafkaConsumerService);
      await kafkaConsumerService.onModuleInit();
    });

    afterEach(async () => {
      await moduleRef.close();
      jest.restoreAllMocks();
    });

    it('first failure (retryCount=0) → republish with retryCount=1 and commitOffsets', async () => {
      const esError = new Error('Elasticsearch connection lost');
      timelineProcessor.processTimeline.mockRejectedValueOnce(esError);

      expect(capturedEachMessage).toBeDefined();
      await capturedEachMessage!({
        topic: 'overlay-metrics.etl.jobs',
        partition: 0,
        message: {
          offset: '100',
          value: Buffer.from(JSON.stringify(createPayload({ retryCount: 0 }))),
          key: null,
        },
      });

      expect(kafkaProducer.sendJob).toHaveBeenCalledTimes(1);
      expect(kafkaProducer.sendJob).toHaveBeenCalledWith(
        expect.objectContaining({ retryCount: 1 }),
      );
      expect(commitOffsetsMock).toHaveBeenCalledWith([
        { topic: 'overlay-metrics.etl.jobs', partition: 0, offset: '101' },
      ]);
      expect(kafkaProducer.sendToDLQ).not.toHaveBeenCalled();
    }, 15000);

    it('second failure (retryCount=1) → republish with retryCount=2 and commitOffsets', async () => {
      const esError = new Error('Elasticsearch cluster unavailable');
      timelineProcessor.processTimeline.mockRejectedValueOnce(esError);

      await capturedEachMessage!({
        topic: 'overlay-metrics.etl.jobs',
        partition: 0,
        message: {
          offset: '101',
          value: Buffer.from(JSON.stringify(createPayload({ retryCount: 1 }))),
          key: null,
        },
      });

      expect(kafkaProducer.sendJob).toHaveBeenCalledTimes(1);
      expect(kafkaProducer.sendJob).toHaveBeenCalledWith(
        expect.objectContaining({ retryCount: 2 }),
      );
      expect(commitOffsetsMock).toHaveBeenCalledWith([
        { topic: 'overlay-metrics.etl.jobs', partition: 0, offset: '102' },
      ]);
      expect(kafkaProducer.sendToDLQ).not.toHaveBeenCalled();
    }, 15000);

    it('third failure (retryCount=3 >= maxRetries) → sendToDLQ called, commitOffsets called', async () => {
      const esError = new Error('Elasticsearch cluster unavailable');
      timelineProcessor.processTimeline.mockRejectedValueOnce(esError);

      await capturedEachMessage!({
        topic: 'overlay-metrics.etl.jobs',
        partition: 0,
        message: {
          offset: '102',
          value: Buffer.from(JSON.stringify(createPayload({ retryCount: 3 }))),
          key: null,
        },
      });

      expect(kafkaProducer.sendToDLQ).toHaveBeenCalledTimes(1);
      expect(kafkaProducer.sendToDLQ).toHaveBeenCalledWith(
        expect.objectContaining({ timelineId, tenantId, matchId }),
        esError,
      );
      expect(commitOffsetsMock).toHaveBeenCalledWith([
        { topic: 'overlay-metrics.etl.jobs', partition: 0, offset: '103' },
      ]);
      expect(pauseMock).not.toHaveBeenCalled();
    });
  });
});
