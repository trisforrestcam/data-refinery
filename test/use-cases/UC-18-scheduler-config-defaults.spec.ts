import { Logger } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Queue } from 'bullmq';
import { SchedulerService } from '@modules/overlay-metrics-etl/scheduler/scheduler.service';
import { SchedulerConfigService } from '@modules/overlay-metrics-etl/scheduler/scheduler-config.service';
import { TenantCacheService } from '@common/modules/tenant-cache/tenant-cache.service';
import {
  OVERLAY_METRICS_QUEUE,
  OVERLAY_METRICS_SCHEDULER_ID,
  OVERLAY_METRICS_JOB,
} from '@common/constants/scheduler.constants';
import appConfig from '@config/app.config';
import mongoConfig from '@config/mongo.config';
import redisConfig from '@config/redis.config';
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
  delete process.env.REDIS_HOST;
  delete process.env.REDIS_PORT;
  delete process.env.REDIS_PASSWORD;
  delete process.env.ELASTICSEARCH_NODE;
  delete process.env.ELASTICSEARCH_USERNAME;
  delete process.env.ELASTICSEARCH_PASSWORD;
  delete process.env.ELASTICSEARCH_APM_INDEX;
  delete process.env.TRACKING_ES_INDEX;
  delete process.env.TRACKING_ES_TIMEOUT_MS;
  delete process.env.OVERLAY_METRICS_TENANT_ID;
  delete process.env.OVERLAY_METRICS_MATCH_ID;
}

/**
 * Tạo mock Queue với jest.fn() cho upsertJobScheduler.
 * Trả về mock queue + ref đến spy upsertJobScheduler.
 */
function createMockQueue(): { queue: Queue; upsertSpy: jest.Mock } {
  const upsertSpy = jest.fn().mockResolvedValue(undefined);
  const queue = {
    upsertJobScheduler: upsertSpy,
    close: jest.fn().mockResolvedValue(undefined),
  } as unknown as Queue;
  return { queue, upsertSpy };
}

/**
 * Tạo NestJS TestingModule chứa SchedulerService với mock Queue và SchedulerConfigService.
 */
async function createSchedulerModule(
  mockQueue: Queue,
  activeTargets: ReturnType<typeof createMockSchedulerConfigService>['activeTargets'],
): Promise<{ module: TestingModule; service: SchedulerService }> {
  const { configService } = createMockSchedulerConfigService(activeTargets);

  const module = await Test.createTestingModule({
    providers: [
      SchedulerService,
      {
        provide: `BullQueue_${OVERLAY_METRICS_QUEUE}`,
        useValue: mockQueue,
      },
      {
        provide: SchedulerConfigService,
        useValue: configService,
      },
    ],
  }).compile();

  const service = module.get<SchedulerService>(SchedulerService);
  return { module, service };
}

function createMockSchedulerConfigService(
  activeTargets: Array<{ tenantId: string; matchId: string; timelineIds: string[] }> = [],
) {
  const configService = {
    getActiveTargets: jest.fn().mockResolvedValue(activeTargets),
  };
  return { configService, activeTargets };
}

// ---------------------------------------------------------------------------
// UC-18: Scheduler đăng ký job & config defaults khi thiếu env vars
// ---------------------------------------------------------------------------

describe('UC-18 - Scheduler đăng ký job & config defaults khi thiếu env vars', () => {
  // ========================================================================
  // Phần 1: Scheduler behaviour
  // ========================================================================
  describe('Scheduler đăng ký job', () => {
    let mockQueue: Queue;
    let upsertSpy: jest.Mock;

    beforeEach(() => {
      resetEnv();
      clearAllAppEnvVars();

      const mock = createMockQueue();
      mockQueue = mock.queue;
      upsertSpy = mock.upsertSpy;
    });

    afterEach(() => {
      resetEnv();
    });

    // ----- Test case 1 -----
    it('onModuleInit gọi upsertJobScheduler với đúng scheduler id, interval 3600000ms, job name "extract-transform-load-metrics"', async () => {
      const { service } = await createSchedulerModule(mockQueue, [
        { tenantId: 'tenant-abc', matchId: 'match-123', timelineIds: ['tl-001'] },
      ]);

      await service.onModuleInit();

      expect(upsertSpy).toHaveBeenCalledTimes(1);

      const [schedulerId, repeatOpts, jobOpts] = upsertSpy.mock.calls[0];

      expect(schedulerId).toBe(OVERLAY_METRICS_SCHEDULER_ID);
      expect(schedulerId).toBe('overlay-metrics-every-5min');

      expect(repeatOpts).toEqual({ every: 3600000 });

      expect(jobOpts.name).toBe(OVERLAY_METRICS_JOB);
      expect(jobOpts.name).toBe('extract-transform-load-metrics');
    });

    // ----- Test case 2 -----
    it('Job opts: attempts=3, backoff exponential delay 5000ms', async () => {
      const { service } = await createSchedulerModule(mockQueue, [
        { tenantId: 'tenant-abc', matchId: 'match-123', timelineIds: ['tl-001'] },
      ]);

      await service.onModuleInit();

      const [, , jobOpts] = upsertSpy.mock.calls[0];

      expect(jobOpts.opts).toEqual({
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
      });
    });

    // ----- Test case 3 -----
    it('Job data truyền đúng timeRangeMinutes=60 và targets array', async () => {
      const targets = [
        { tenantId: 'tenant-abc', matchId: 'match-123', timelineIds: ['tl-001', 'tl-002'] },
      ];
      const { service } = await createSchedulerModule(mockQueue, targets);

      await service.onModuleInit();

      const [, , jobOpts] = upsertSpy.mock.calls[0];

      expect(jobOpts.data).toEqual({
        timeRangeMinutes: 60,
        targets,
      });
    });

    // ----- Test case 4 -----
    it('Không gọi upsertJobScheduler khi không có active targets', async () => {
      const { service } = await createSchedulerModule(mockQueue, []);

      await service.onModuleInit();

      expect(upsertSpy).not.toHaveBeenCalled();
    });

    // ----- Test case 5 -----
    it('Log warning khi không có targets, log success khi đăng ký thành công', async () => {
      const { service } = await createSchedulerModule(mockQueue, [
        { tenantId: 'tenant-abc', matchId: 'match-123', timelineIds: ['tl-001'] },
      ]);
      const loggerSpy = jest.spyOn(Logger.prototype, 'log');
      const warnSpy = jest.spyOn(Logger.prototype, 'warn');

      await service.onModuleInit();
      expect(loggerSpy).toHaveBeenCalledWith(
        expect.stringContaining('Overlay metrics scheduler registered'),
      );

      loggerSpy.mockClear();
      warnSpy.mockClear();

      const { service: serviceEmpty } = await createSchedulerModule(mockQueue, []);
      await serviceEmpty.onModuleInit();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          'Overlay metrics scheduler: no active targets found',
        ),
      );
      expect(loggerSpy).not.toHaveBeenCalledWith(
        expect.stringContaining('Overlay metrics scheduler registered'),
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

    // ----- Test case 6 -----
    it('Không set ANY env vars → tất cả config dùng giá trị default', () => {
      const app = appConfig();
      const mongo = mongoConfig();
      const redis = redisConfig();
      const es = elasticsearchConfig();

      expect(app.port).toBe(3000);
      expect(app.env).toBe('development');
      expect(app.elasticApmEnvironment).toBe('development');

      expect(mongo.uri).toBe('mongodb://localhost:27017/datarefinery');

      expect(redis.host).toBe('localhost');
      expect(redis.port).toBe(6379);
      expect(redis.password).toBeUndefined();

      expect(es.node).toBe('http://localhost:9200');
      expect(es.trackingIndex).toBe('tracking-events-*');
      expect(es.apmIndex).toBe('traces-apm-*');
      expect(es.trackingTimeoutMs).toBe(10000);
    });

    // ----- Test case 7 -----
    it('Set PORT=5001 → app.port=5001, các config khác vẫn default', () => {
      process.env.PORT = '5001';

      const app = appConfig();
      const mongo = mongoConfig();
      const redis = redisConfig();
      const es = elasticsearchConfig();

      expect(app.port).toBe(5001);
      expect(mongo.uri).toBe('mongodb://localhost:27017/datarefinery');
      expect(redis.host).toBe('localhost');
      expect(es.node).toBe('http://localhost:9200');
    });

    // ----- Test case 8 -----
    it('Set MONGODB_URI → override default mongo uri', () => {
      process.env.MONGODB_URI = 'mongodb://prod-host:27017/production-db';

      const mongo = mongoConfig();

      expect(mongo.uri).toBe('mongodb://prod-host:27017/production-db');
    });

    // ----- Test case 9 -----
    it('Set ELASTICSEARCH_NODE và TRACKING_ES_INDEX → override ES defaults', () => {
      process.env.ELASTICSEARCH_NODE = 'http://es-prod:9200';
      process.env.TRACKING_ES_INDEX = 'tracking-events-v2-*';

      const es = elasticsearchConfig();

      expect(es.node).toBe('http://es-prod:9200');
      expect(es.trackingIndex).toBe('tracking-events-v2-*');
    });

    // ----- Test case 10 -----
    it('Set REDIS_HOST, REDIS_PORT, REDIS_PASSWORD → override redis defaults', () => {
      process.env.REDIS_HOST = 'redis-prod';
      process.env.REDIS_PORT = '6380';
      process.env.REDIS_PASSWORD = 's3cret';

      const redis = redisConfig();

      expect(redis.host).toBe('redis-prod');
      expect(redis.port).toBe(6380);
      expect(redis.password).toBe('s3cret');
    });

    // ----- Test case 11 -----
    it('Set NODE_ENV=production, ELASTIC_APM_ENVIRONMENT=staging → override app defaults', () => {
      process.env.NODE_ENV = 'production';
      process.env.ELASTIC_APM_ENVIRONMENT = 'staging';

      const app = appConfig();

      expect(app.env).toBe('production');
      expect(app.elasticApmEnvironment).toBe('staging');
    });

    // ----- Test case 12 -----
    it('PORT giá trị không phải số (NaN) → fallback về default 3000', () => {
      process.env.PORT = 'not-a-number';

      const app = appConfig();

      expect(app.port).toBe(3000);
    });

    // ----- Test case 13 -----
    it('REDIS_PORT giá trị không phải số → fallback về default 6379', () => {
      process.env.REDIS_PORT = 'abc';

      const redis = redisConfig();

      expect(redis.port).toBe(6379);
    });

    // ----- Test case 14 -----
    it('TRACKING_ES_TIMEOUT_MS override được và parse đúng số', () => {
      process.env.TRACKING_ES_TIMEOUT_MS = '30000';

      const es = elasticsearchConfig();

      expect(es.trackingTimeoutMs).toBe(30000);
    });

    // ----- Test case 15 -----
    it('TRACKING_ES_TIMEOUT_MS giá trị NaN → fallback default 10000', () => {
      process.env.TRACKING_ES_TIMEOUT_MS = 'invalid';

      const es = elasticsearchConfig();

      expect(es.trackingTimeoutMs).toBe(10000);
    });
  });
});
