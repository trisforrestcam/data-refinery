import { Test, TestingModule } from '@nestjs/testing';
import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MetricsApiController } from '@modules/overlay-metrics-api/metrics-api.controller';
import { MetricsApiService } from '@modules/overlay-metrics-api/metrics-api.service';
import { InternalApiGuard } from '@common/guards/internal-api.guard';
import { MetricsQueryDto } from '@modules/overlay-metrics-api/dto/metrics-query.dto';
import { BackfillJobDto } from '@modules/overlay-metrics-api/dto/backfill-job.dto';
import { OverlayMetricsRepository } from '@infrastructure/persistence/overlay-metrics.repository';
import { SchedulerConfigService } from '@modules/overlay-metrics-etl/scheduler/scheduler-config.service';
import { JobProducerService } from '@modules/overlay-metrics-etl/kafka/job-producer.service';
import { MetricType } from '@domain/enums/metric-type.enum';

describe('UC-19 - Read API tests', () => {
  const tenantId = 'tenant-read-001';
  const apiKey = 'test-secret-key-123';

  beforeAll(() => {
    process.env.INTERNAL_API_KEY = apiKey;
  });

  afterAll(() => {
    delete process.env.INTERNAL_API_KEY;
  });

  describe('InternalApiGuard', () => {
    let guard: InternalApiGuard;

    const createMockContext = (headers: Record<string, string>): ExecutionContext =>
      ({
        switchToHttp: () => ({
          getRequest: () => ({ headers }),
        }),
      }) as ExecutionContext;

    const createGuard = (key: string | undefined): InternalApiGuard => {
      const config = new ConfigService({ app: { internalApiKey: key } });
      return new InternalApiGuard(config);
    };

    it('allow request với đúng api key', () => {
      guard = createGuard(apiKey);
      const ctx = createMockContext({ 'x-internal-api-key': apiKey });
      expect(guard.canActivate(ctx)).toBe(true);
    });

    it('reject khi thiếu header', () => {
      guard = createGuard(apiKey);
      const ctx = createMockContext({});
      expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
      expect(() => guard.canActivate(ctx)).toThrow('Invalid or missing internal API key');
    });

    it('reject khi api key sai', () => {
      guard = createGuard(apiKey);
      const ctx = createMockContext({ 'x-internal-api-key': 'wrong-key' });
      expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
    });

    it('reject khi INTERNAL_API_KEY chưa configure', () => {
      guard = createGuard(undefined);
      const ctx = createMockContext({ 'x-internal-api-key': apiKey });
      expect(() => guard.canActivate(ctx)).toThrow('INTERNAL_API_KEY not configured');
    });
  });

  describe('MetricsApiService buildFilter', () => {
    let service: MetricsApiService;
    let repository: { find: jest.Mock };
    let jobProducerService: { triggerBackfill: jest.Mock };

    beforeEach(async () => {
      repository = { find: jest.fn().mockResolvedValue([]) };
      jobProducerService = { triggerBackfill: jest.fn().mockResolvedValue({ status: 'published', correlationId: 'corr-123' }) };

      const moduleRef = await Test.createTestingModule({
        providers: [
          MetricsApiService,
          { provide: OverlayMetricsRepository, useValue: repository },
          { provide: JobProducerService, useValue: jobProducerService },
          { provide: SchedulerConfigService, useValue: { getActiveTargets: jest.fn(), upsertTarget: jest.fn(), disableTarget: jest.fn() } },
        ],
      }).compile();

      service = moduleRef.get(MetricsApiService);
    });

    it('filter chỉ có tenantId khi query rỗng', async () => {
      await service.getPlatformMetrics(tenantId, {});
      expect(repository.find).toHaveBeenCalledWith(tenantId, MetricType.PLATFORM, { tenantId });
    });

    it('filter có matchId equality', async () => {
      const query: MetricsQueryDto = { matchId: 'match-123' };
      await service.getPlatformMetrics(tenantId, query);
      expect(repository.find).toHaveBeenCalledWith(tenantId, MetricType.PLATFORM, {
        tenantId,
        matchId: 'match-123',
      });
    });

    it('filter có timelineIds $in array', async () => {
      const query: MetricsQueryDto = { timelineIds: ['tl-1', 'tl-2'] };
      await service.getDeviceBreakdown(tenantId, query);
      expect(repository.find).toHaveBeenCalledWith(tenantId, MetricType.DEVICE, {
        tenantId,
        timelineId: { $in: ['tl-1', 'tl-2'] },
      });
    });

    it('filter có date range trên intervalFrom', async () => {
      const query: MetricsQueryDto = {
        from: '2024-01-01T00:00:00Z',
        to: '2024-01-02T00:00:00Z',
      };
      await service.getTransportComparison(tenantId, query);
      expect(repository.find).toHaveBeenCalledWith(tenantId, MetricType.TRANSPORT, {
        tenantId,
        intervalFrom: {
          $gte: new Date('2024-01-01T00:00:00Z'),
          $lte: new Date('2024-01-02T00:00:00Z'),
        },
      });
    });

    it('filter kết hợp tất cả fields', async () => {
      const query: MetricsQueryDto = {
        matchId: 'match-abc',
        timelineIds: ['tl-1'],
        from: '2024-01-01T00:00:00Z',
        to: '2024-01-02T00:00:00Z',
      };
      await service.getFailures(tenantId, query);
      expect(repository.find).toHaveBeenCalledWith(tenantId, MetricType.FAILURE, {
        tenantId,
        matchId: 'match-abc',
        timelineId: { $in: ['tl-1'] },
        intervalFrom: {
          $gte: new Date('2024-01-01T00:00:00Z'),
          $lte: new Date('2024-01-02T00:00:00Z'),
        },
      });
    });

    it('timeseries filter thêm metric name', async () => {
      await service.getTimeseries(tenantId, {}, 'sent');
      expect(repository.find).toHaveBeenCalledWith(tenantId, MetricType.TIMESERIES, {
        tenantId,
        metric: 'sent',
      });
    });

    it('triggerBackfill gọi jobProducerService.triggerBackfill với đúng DTO', async () => {
      const dto: BackfillJobDto = {
        tenantId: 'tenant-001',
        matchId: 'match-123',
        timelineIds: ['tl-1', 'tl-2'],
        timeRangeMinutes: 5,
      };

      await service.triggerBackfill(tenantId, dto);

      expect(jobProducerService.triggerBackfill).toHaveBeenCalledWith(tenantId, dto);
    });

    it('triggerBackfill trả về status published và correlationId', async () => {
      const dto: BackfillJobDto = {
        tenantId: 'tenant-001',
        matchId: 'match-123',
        timelineIds: ['tl-1'],
      };

      jobProducerService.triggerBackfill = jest.fn().mockResolvedValue({
        status: 'published',
        correlationId: 'uuid-abc-123',
      });

      const result = await service.triggerBackfill(tenantId, dto);

      expect(result).toMatchObject({
        status: 'published',
        correlationId: 'uuid-abc-123',
      });
    });
  });

  describe('MetricsApiController routing', () => {
    let controller: MetricsApiController;
    let service: {
      getPlatformMetrics: jest.Mock;
      getTimeseries: jest.Mock;
      triggerBackfill: jest.Mock;
    };

    beforeEach(async () => {
      service = {
        getPlatformMetrics: jest.fn().mockResolvedValue([{ platform: 'web' }]),
        getTimeseries: jest.fn().mockResolvedValue([{ metric: 'sent' }]),
        triggerBackfill: jest.fn().mockResolvedValue({ status: 'published', correlationId: 'corr-test' }),
      };

      const moduleRef = await Test.createTestingModule({
        controllers: [MetricsApiController],
        providers: [
          { provide: MetricsApiService, useValue: service },
          { provide: ConfigService, useValue: { get: () => apiKey } },
        ],
      }).compile();

      controller = moduleRef.get(MetricsApiController);
    });

    it('getPlatform delegate đúng service method', async () => {
      const query: MetricsQueryDto = { matchId: 'm1' };
      const result = await controller.getPlatform(tenantId, query);
      expect(service.getPlatformMetrics).toHaveBeenCalledWith(tenantId, query);
      expect(result).toEqual([{ platform: 'web' }]);
    });

    it('getTimeseries truyền metric param', async () => {
      const query: MetricsQueryDto = {};
      const result = await controller.getTimeseries(tenantId, query, 'received');
      expect(service.getTimeseries).toHaveBeenCalledWith(tenantId, query, 'received');
      expect(result).toEqual([{ metric: 'sent' }]);
    });

    it('backfill endpoint trả về status published và correlationId', async () => {
      const dto: BackfillJobDto = {
        tenantId: 'tenant-001',
        matchId: 'match-123',
        timelineIds: ['tl-1'],
      };

      const result = await controller.backfill(tenantId, dto);

      expect(service.triggerBackfill).toHaveBeenCalledWith(tenantId, dto);
      expect(result).toMatchObject({
        status: 'published',
        correlationId: 'corr-test',
      });
    });
  });
});
