import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import {
  KafkaProducerService,
  JobPayload,
} from '@modules/overlay-metrics-etl/kafka/kafka-producer.service';

// ---------------------------------------------------------------------------
// Mock kafkajs Producer
// ---------------------------------------------------------------------------

const sendMock = jest.fn().mockResolvedValue([]);
const connectMock = jest.fn().mockResolvedValue(undefined);
const disconnectMock = jest.fn().mockResolvedValue(undefined);

const mockProducer = {
  connect: connectMock,
  send: sendMock,
  disconnect: disconnectMock,
};

jest.mock('kafkajs', () => ({
  Kafka: jest.fn().mockImplementation(() => ({
    producer: jest.fn().mockReturnValue(mockProducer),
  })),
  Partitioners: {
    DefaultPartitioner: jest.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('KafkaProducerService', () => {
  let service: KafkaProducerService;

  const createMockConfigService = () => ({
    get: jest.fn((key: string) => {
      const map: Record<string, unknown> = {
        'kafka.clientId': 'data-refinery-test',
        'kafka.brokers': ['localhost:9092'],
        'kafka.dlqTopic': 'overlay-metrics.etl.dlq',
      };
      return map[key];
    }),
  });

  beforeEach(async () => {
    sendMock.mockClear();
    connectMock.mockClear();
    disconnectMock.mockClear();

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        KafkaProducerService,
        { provide: ConfigService, useValue: createMockConfigService() },
      ],
    }).compile();

    service = moduleRef.get(KafkaProducerService);
    await service.onModuleInit();
  });

  afterEach(async () => {
    await service.onModuleDestroy();
  });

  describe('sendJob', () => {
    it('gửi message vào topic overlay-metrics.etl.jobs với key chứa tenantId|matchId|timelineId', async () => {
      const payload: JobPayload = {
        tenantId: 'tenant-001',
        matchId: 'match-123',
        timelineId: 'tl-001',
        timeRangeMinutes: 60,
        origin: 'scheduled',
      };

      await service.sendJob(payload);

      expect(sendMock).toHaveBeenCalledTimes(1);
      const [{ topic, messages }] = sendMock.mock.calls[0];

      expect(topic).toBe('overlay-metrics.etl.jobs');
      expect(messages[0].key).toBe('tenant-001|match-123|tl-001');

      const parsedValue = JSON.parse(messages[0].value);
      expect(parsedValue.version).toBe(1);
      expect(parsedValue.jobType).toBe('extract-transform-load-metrics');
      expect(parsedValue.tenantId).toBe('tenant-001');
      expect(parsedValue.timelineId).toBe('tl-001');
    });

    it('gửi message với đầy đủ payload fields', async () => {
      const payload: JobPayload = {
        tenantId: 'tenant-002',
        matchId: 'match-456',
        timelineId: 'tl-002',
        timeRangeMinutes: 5,
        intervalFrom: '2024-01-01T00:00:00Z',
        intervalTo: '2024-01-01T00:05:00Z',
        retryCount: 0,
        origin: 'backfill',
        correlationId: 'corr-abc',
      };

      await service.sendJob(payload);

      const parsedValue = JSON.parse(
        sendMock.mock.calls[0][0].messages[0].value,
      );
      expect(parsedValue).toMatchObject({
        version: 1,
        jobType: 'extract-transform-load-metrics',
        tenantId: 'tenant-002',
        matchId: 'match-456',
        timelineId: 'tl-002',
        timeRangeMinutes: 5,
        intervalFrom: '2024-01-01T00:00:00Z',
        intervalTo: '2024-01-01T00:05:00Z',
        retryCount: 0,
        origin: 'backfill',
        correlationId: 'corr-abc',
      });
    });
  });

  describe('sendToDLQ', () => {
    it('gửi message thất bại vào DLQ topic với errorMessage, errorStack, failedAt', async () => {
      const payload: JobPayload = {
        tenantId: 'tenant-003',
        matchId: 'match-789',
        timelineId: 'tl-003',
        timeRangeMinutes: 60,
      };
      const error = new Error('ES connection timeout');

      await service.sendToDLQ(payload, error);

      expect(sendMock).toHaveBeenCalledTimes(1);
      const [{ topic, messages }] = sendMock.mock.calls[0];

      expect(topic).toBe('overlay-metrics.etl.dlq');

      const parsedValue = JSON.parse(messages[0].value);
      expect(parsedValue.errorMessage).toBe('ES connection timeout');
      expect(parsedValue.errorStack).toBeDefined();
      expect(parsedValue.failedAt).toBeDefined();
      expect(new Date(parsedValue.failedAt).toISOString()).toBe(
        parsedValue.failedAt,
      );
      expect(parsedValue.tenantId).toBe('tenant-003');
      expect(parsedValue.timelineId).toBe('tl-003');
    });
  });
});
