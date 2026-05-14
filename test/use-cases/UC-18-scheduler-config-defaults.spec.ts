import { Logger } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JobProducerService } from '@modules/overlay-metrics-etl/kafka/job-producer.service';
import { SchedulerConfigService } from '@modules/overlay-metrics-etl/scheduler/scheduler-config.service';
import { KafkaProducerService } from '@modules/overlay-metrics-etl/kafka/kafka-producer.service';
import appConfig from '@config/app.config';
import mongoConfig from '@config/mongo.config';
import kafkaConfig from '@config/kafka.config';
import elasticsearchConfig from '@config/elasticsearch.config';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Lưu lại env gốc để restore sau mỗi test */
const originalEnv = { ...process.env };

function resetEnv(): void {
  process.env = { ...originalEnv };
}

function clearAllAppEnvVars(): void {
  delete process.env.NODE_ENV;
  delete process.env.PORT;
  delete process.env.ELASTIC_APM_ENVIRONMENT;
  delete process.env.MONGODB_URI;
  delete process.env.KAFKA_BROKERS;
  delete process.env.KAFKA_CLIENT_ID;
  delete process.env.KAFKA_GROUP_ID;
  delete process.env.KAFKA_DLQ_TOPIC;
  delete process.env.KAFKA_MAX_RETRIES;
  delete process.env.KAFKA_RETRY_DELAY_MS;
  delete process.env.ELASTICSEARCH_NODE;
  delete process.env.ELASTICSEARCH_USERNAME;
  delete process.env.ELASTICSEARCH_PASSWORD;
  delete process.env.ELASTICSEARCH_APM_INDEX;
  delete process.env.TRACKING_ES_INDEX;
  delete process.env.TRACKING_ES_TIMEOUT_MS;
  delete process.env.OVERLAY_METRICS_TENANT_ID;
  delete process.env.OVERLAY_METRICS_MATCH_ID;
}

function createMockSchedulerConfigService(
  activeTargets: Array<{ tenantId: string; matchId: string; timelineIds: string[] }> = [],
) {
  const configService = {
    getActiveTargets: jest.fn().mockResolvedValue(activeTargets),
  };
  return { configService, activeTargets };
}

/**
 * Tạo NestJS TestingModule chứa JobProducerService với mock dependencies.
 */
async function createJobProducerModule(
  activeTargets: ReturnType<typeof createMockSchedulerConfigService>['activeTargets'],
): Promise<{ module: TestingModule; service: JobProducerService }> {
  const { configService } = createMockSchedulerConfigService(activeTargets);
  const kafkaProducerMock = { sendJob: jest.fn().mockResolvedValue(undefined) };

  const module = await Test.createTestingModule({
    providers: [
      JobProducerService,
      {
        provide: SchedulerConfigService,
        useValue: configService,
      },
      {
        provide: KafkaProducerService,
        useValue: kafkaProducerMock,
      },
    ],
  }).compile();

  const service = module.get<JobProducerService>(JobProducerService);
  return { module, service };
}

// ---------------------------------------------------------------------------
// UC-18: JobProducer đăng ký cron & config defaults khi thiếu env vars
// ---------------------------------------------------------------------------

describe('UC-18 - JobProducer đăng ký cron & config defaults khi thiếu env vars', () => {
  // ========================================================================
  // Phần 1: JobProducer behaviour
  // ========================================================================
  describe('JobProducer cron behaviour', () => {
    afterEach(() => {
      resetEnv();
    });

    // ----- Test case 1 -----
    it('handleCron gọi sendJob một lần mỗi timeline với payload đúng (timeRangeMinutes: 60, origin: scheduled)', async () => {
      const { service } = await createJobProducerModule([
        { tenantId: 'tenant-abc', matchId: 'match-123', timelineIds: ['tl-001', 'tl-002'] },
      ]);

      await service.handleCron();

      const kafkaProducer = (service as unknown as Record<string, unknown>)['kafkaProducer'] as {
        sendJob: jest.Mock;
      };

      expect(kafkaProducer.sendJob).toHaveBeenCalledTimes(2);
      expect(kafkaProducer.sendJob).toHaveBeenNthCalledWith(1, expect.objectContaining({
        tenantId: 'tenant-abc',
        matchId: 'match-123',
        timelineId: 'tl-001',
        timeRangeMinutes: 60,
        origin: 'scheduled',
        retryCount: 0,
      }));
      expect(kafkaProducer.sendJob).toHaveBeenNthCalledWith(2, expect.objectContaining({
        tenantId: 'tenant-abc',
        matchId: 'match-123',
        timelineId: 'tl-002',
        timeRangeMinutes: 60,
        origin: 'scheduled',
        retryCount: 0,
      }));
    });

    // ----- Test case 2 -----
    it('Log warning và không gọi sendJob khi không có active targets', async () => {
      const { service } = await createJobProducerModule([]);
      const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

      await service.handleCron();

      const kafkaProducer = (service as unknown as Record<string, unknown>)['kafkaProducer'] as {
        sendJob: jest.Mock;
      };

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Overlay metrics scheduler: no active targets found'),
      );
      expect(kafkaProducer.sendJob).not.toHaveBeenCalled();

      warnSpy.mockRestore();
    });

    // ----- Test case 3 -----
    it('Targets được lọc theo OVERLAY_METRICS_TENANT_ID env var', async () => {
      process.env.OVERLAY_METRICS_TENANT_ID = 'tenant-abc';

      const { configService } = createMockSchedulerConfigService([
        { tenantId: 'tenant-abc', matchId: 'match-123', timelineIds: ['tl-001'] },
        { tenantId: 'tenant-xyz', matchId: 'match-456', timelineIds: ['tl-002'] },
      ]);
      const kafkaProducerMock = { sendJob: jest.fn().mockResolvedValue(undefined) };

      const module = await Test.createTestingModule({
        providers: [
          JobProducerService,
          { provide: SchedulerConfigService, useValue: configService },
          { provide: KafkaProducerService, useValue: kafkaProducerMock },
        ],
      }).compile();

      const service = module.get<JobProducerService>(JobProducerService);

      // Mock getActiveTargets để trả về chỉ targets của tenant được filter
      configService.getActiveTargets = jest.fn().mockResolvedValue([
        { tenantId: 'tenant-abc', matchId: 'match-123', timelineIds: ['tl-001'] },
      ]);

      await service.handleCron();

      expect(kafkaProducerMock.sendJob).toHaveBeenCalledTimes(1);
      expect(kafkaProducerMock.sendJob).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: 'tenant-abc', timelineId: 'tl-001' }),
      );
    });
  });

  // ========================================================================
  // Phần 2: Config defaults
  // ========================================================================
  describe('Config defaults khi thiếu env vars', () => {
    beforeEach(() => {
      resetEnv();
      clearAllAppEnvVars();
    });

    afterEach(() => {
      resetEnv();
    });

    // ----- Test case 4 -----
    it('Không set ANY env vars → tất cả config dùng giá trị default', () => {
      const app = appConfig();
      const mongo = mongoConfig();
      const kafka = kafkaConfig();
      const es = elasticsearchConfig();

      expect(app.port).toBe(3000);
      expect(app.env).toBe('development');
      expect(app.elasticApmEnvironment).toBe('development');

      expect(mongo.uri).toBe('mongodb://localhost:27017/datarefinery');

      expect(kafka.brokers).toEqual(['localhost:9092']);
      expect(kafka.clientId).toBe('data-refinery');
      expect(kafka.groupId).toBe('data-refinery-etl-consumers');
      expect(kafka.dlqTopic).toBe('overlay-metrics.etl.dlq');
      expect(kafka.maxRetries).toBe(3);
      expect(kafka.retryDelayMs).toBe(5000);

      expect(es.node).toBe('http://localhost:9200');
      expect(es.trackingIndex).toBe('tracking-events-*');
      expect(es.apmIndex).toBe('traces-apm-*');
      expect(es.trackingTimeoutMs).toBe(10000);
    });

    // ----- Test case 5 -----
    it('Set PORT=5001 → app.port=5001, các config khác vẫn default', () => {
      process.env.PORT = '5001';

      const app = appConfig();
      const mongo = mongoConfig();
      const kafka = kafkaConfig();
      const es = elasticsearchConfig();

      expect(app.port).toBe(5001);
      expect(mongo.uri).toBe('mongodb://localhost:27017/datarefinery');
      expect(kafka.brokers).toEqual(['localhost:9092']);
      expect(es.node).toBe('http://localhost:9200');
    });

    // ----- Test case 6 -----
    it('Set MONGODB_URI → override default mongo uri', () => {
      process.env.MONGODB_URI = 'mongodb://prod-host:27017/production-db';

      const mongo = mongoConfig();

      expect(mongo.uri).toBe('mongodb://prod-host:27017/production-db');
    });

    // ----- Test case 7 -----
    it('Set ELASTICSEARCH_NODE và TRACKING_ES_INDEX → override ES defaults', () => {
      process.env.ELASTICSEARCH_NODE = 'http://es-prod:9200';
      process.env.TRACKING_ES_INDEX = 'tracking-events-v2-*';

      const es = elasticsearchConfig();

      expect(es.node).toBe('http://es-prod:9200');
      expect(es.trackingIndex).toBe('tracking-events-v2-*');
    });

    // ----- Test case 8 -----
    it('Set KAFKA_BROKERS, KAFKA_CLIENT_ID, KAFKA_GROUP_ID → override kafka defaults', () => {
      process.env.KAFKA_BROKERS = 'kafka-1:9092,kafka-2:9092';
      process.env.KAFKA_CLIENT_ID = 'data-refinery-prod';
      process.env.KAFKA_GROUP_ID = 'etl-consumers-prod';

      const kafka = kafkaConfig();

      expect(kafka.brokers).toEqual(['kafka-1:9092', 'kafka-2:9092']);
      expect(kafka.clientId).toBe('data-refinery-prod');
      expect(kafka.groupId).toBe('etl-consumers-prod');
    });

    // ----- Test case 9 -----
    it('Set NODE_ENV=production, ELASTIC_APM_ENVIRONMENT=staging → override app defaults', () => {
      process.env.NODE_ENV = 'production';
      process.env.ELASTIC_APM_ENVIRONMENT = 'staging';

      const app = appConfig();

      expect(app.env).toBe('production');
      expect(app.elasticApmEnvironment).toBe('staging');
    });

    // ----- Test case 10 -----
    it('PORT giá trị không phải số (NaN) → fallback về default 3000', () => {
      process.env.PORT = 'not-a-number';

      const app = appConfig();

      expect(app.port).toBe(3000);
    });

    // ----- Test case 11 -----
    it('KAFKA_MAX_RETRIES giá trị không phải số → fallback về default 3', () => {
      process.env.KAFKA_MAX_RETRIES = 'abc';

      const kafka = kafkaConfig();

      expect(kafka.maxRetries).toBe(3);
    });

    // ----- Test case 12 -----
    it('TRACKING_ES_TIMEOUT_MS override được và parse đúng số', () => {
      process.env.TRACKING_ES_TIMEOUT_MS = '30000';

      const es = elasticsearchConfig();

      expect(es.trackingTimeoutMs).toBe(30000);
    });

    // ----- Test case 13 -----
    it('TRACKING_ES_TIMEOUT_MS giá trị NaN → fallback default 10000', () => {
      process.env.TRACKING_ES_TIMEOUT_MS = 'invalid';

      const es = elasticsearchConfig();

      expect(es.trackingTimeoutMs).toBe(10000);
    });

    // ----- Test case 14 -----
    it('KAFKA_RETRY_DELAY_MS override được và parse đúng số', () => {
      process.env.KAFKA_RETRY_DELAY_MS = '10000';

      const kafka = kafkaConfig();

      expect(kafka.retryDelayMs).toBe(10000);
    });

    // ----- Test case 15 -----
    it('KAFKA_DLQ_TOPIC override được', () => {
      process.env.KAFKA_DLQ_TOPIC = 'custom.dlq.topic';

      const kafka = kafkaConfig();

      expect(kafka.dlqTopic).toBe('custom.dlq.topic');
    });
  });
});
