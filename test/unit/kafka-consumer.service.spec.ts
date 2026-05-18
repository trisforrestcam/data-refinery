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
// Mock kafkajs Consumer
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

describe('KafkaConsumerService', () => {
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

  const createPayload = (overrides?: Partial<JobPayload>): JobPayload => ({
    version: 1,
    jobType: 'extract-transform-load-metrics',
    tenantId: 'tenant-001',
    matchId: 'match-123',
    timelineId: 'tl-001',
    timeRangeMinutes: 60,
    origin: 'scheduled',
    ...overrides,
  });

  const invokeEachMessage = async (
    payload: Partial<{
      topic: string;
      partition: number;
      offset: string;
      value: Buffer | null;
    }> = {},
  ) => {
    expect(capturedEachMessage).toBeDefined();
    await capturedEachMessage!({
      topic: payload.topic ?? 'overlay-metrics.etl.jobs',
      partition: payload.partition ?? 0,
      message: {
        offset: payload.offset ?? '100',
        value: payload.value ?? Buffer.from(JSON.stringify(createPayload())),
        key: null,
      },
    });
  };

  beforeEach(() => {
    pauseMock.mockClear();
    resumeMock.mockClear();
    commitOffsetsMock.mockClear();
    connectMock.mockClear();
    subscribeMock.mockClear();
    runMock.mockClear();
    disconnectMock.mockClear();
    capturedEachMessage = undefined;
  });

  describe('success flow', () => {
    let moduleRef: TestingModule;
    let timelineProcessor: { processTimeline: jest.Mock };
    let kafkaProducer: { sendToDLQ: jest.Mock };

    beforeEach(async () => {
      timelineProcessor = {
        processTimeline: jest.fn().mockResolvedValue(undefined),
      };
      kafkaProducer = { sendToDLQ: jest.fn().mockResolvedValue(undefined) };

      jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
      jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

      moduleRef = await Test.createTestingModule({
        providers: [
          KafkaConsumerService,
          { provide: ConfigService, useValue: createMockConfigService() },
          { provide: KafkaProducerService, useValue: kafkaProducer },
          { provide: TimelineProcessorService, useValue: timelineProcessor },
        ],
      }).compile();

      const service = moduleRef.get(KafkaConsumerService);
      await service.onModuleInit();
    });

    afterEach(async () => {
      await moduleRef.close();
      jest.restoreAllMocks();
    });

    it('processTimeline được gọi và commitOffsets được gọi với offset+1', async () => {
      await invokeEachMessage({ offset: '200' });

      expect(timelineProcessor.processTimeline).toHaveBeenCalledTimes(1);
      expect(commitOffsetsMock).toHaveBeenCalledWith([
        { topic: 'overlay-metrics.etl.jobs', partition: 0, offset: '201' },
      ]);
    });
  });

  describe('retry flow', () => {
    let moduleRef: TestingModule;
    let timelineProcessor: { processTimeline: jest.Mock };
    let kafkaProducer: { sendJob: jest.Mock; sendToDLQ: jest.Mock };

    beforeEach(async () => {
      timelineProcessor = {
        processTimeline: jest.fn().mockRejectedValue(new Error('ES timeout')),
      };
      kafkaProducer = {
        sendJob: jest.fn().mockResolvedValue(undefined),
        sendToDLQ: jest.fn().mockResolvedValue(undefined),
      };

      jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
      jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

      moduleRef = await Test.createTestingModule({
        providers: [
          KafkaConsumerService,
          { provide: ConfigService, useValue: createMockConfigService() },
          { provide: KafkaProducerService, useValue: kafkaProducer },
          { provide: TimelineProcessorService, useValue: timelineProcessor },
        ],
      }).compile();

      const service = moduleRef.get(KafkaConsumerService);
      await service.onModuleInit();
    });

    afterEach(async () => {
      await moduleRef.close();
      jest.restoreAllMocks();
    });

    it('processTimeline throw → republish with retryCount+1 and commitOffsets', async () => {
      await invokeEachMessage({ offset: '300' });

      expect(kafkaProducer.sendJob).toHaveBeenCalledTimes(1);
      expect(kafkaProducer.sendJob).toHaveBeenCalledWith(
        expect.objectContaining({ retryCount: 1 }),
      );
      expect(commitOffsetsMock).toHaveBeenCalledWith([
        { topic: 'overlay-metrics.etl.jobs', partition: 0, offset: '301' },
      ]);
      expect(pauseMock).not.toHaveBeenCalled();
    }, 15000);

    it('retryCount >= maxRetries → sendToDLQ được gọi và commitOffsets được gọi', async () => {
      await invokeEachMessage({
        offset: '400',
        value: Buffer.from(JSON.stringify(createPayload({ retryCount: 3 }))),
      });

      expect(kafkaProducer.sendToDLQ).toHaveBeenCalledTimes(1);
      expect(kafkaProducer.sendToDLQ).toHaveBeenCalledWith(
        expect.objectContaining({ timelineId: 'tl-001' }),
        expect.objectContaining({ message: 'ES timeout' }),
      );
      expect(commitOffsetsMock).toHaveBeenCalledWith([
        { topic: 'overlay-metrics.etl.jobs', partition: 0, offset: '401' },
      ]);
      expect(pauseMock).not.toHaveBeenCalled();
    });
  });

  describe('parse error', () => {
    let moduleRef: TestingModule;
    let timelineProcessor: { processTimeline: jest.Mock };
    let kafkaProducer: { sendToDLQ: jest.Mock };

    beforeEach(async () => {
      timelineProcessor = {
        processTimeline: jest.fn().mockResolvedValue(undefined),
      };
      kafkaProducer = { sendToDLQ: jest.fn().mockResolvedValue(undefined) };

      jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
      jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

      moduleRef = await Test.createTestingModule({
        providers: [
          KafkaConsumerService,
          { provide: ConfigService, useValue: createMockConfigService() },
          { provide: KafkaProducerService, useValue: kafkaProducer },
          { provide: TimelineProcessorService, useValue: timelineProcessor },
        ],
      }).compile();

      const service = moduleRef.get(KafkaConsumerService);
      await service.onModuleInit();
    });

    afterEach(async () => {
      await moduleRef.close();
      jest.restoreAllMocks();
    });

    it('JSON parse error → sendToDLQ được gọi và commitOffsets được gọi', async () => {
      await invokeEachMessage({
        offset: '500',
        value: Buffer.from('not-valid-json'),
      });

      expect(timelineProcessor.processTimeline).not.toHaveBeenCalled();
      expect(kafkaProducer.sendToDLQ).toHaveBeenCalledTimes(1);
      expect(commitOffsetsMock).toHaveBeenCalledWith([
        { topic: 'overlay-metrics.etl.jobs', partition: 0, offset: '501' },
      ]);
    });
  });
});
