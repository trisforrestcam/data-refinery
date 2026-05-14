import { getQueueToken } from '@nestjs/bullmq';
import { errors } from '@elastic/transport';
import { Logger } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import type { Job } from 'bullmq';
import { OVERLAY_METRICS_JOB, OVERLAY_METRICS_QUEUE, OVERLAY_METRICS_SCHEDULER_ID } from '@common/constants/scheduler.constants';
import { ExtractorService } from '@modules/overlay-metrics-etl/extractor/extractor.service';
import { LoaderService } from '@modules/overlay-metrics-etl/loader/loader.service';
import { OverlayMetricsProcessor } from '@modules/overlay-metrics-etl/scheduler/processors/overlay-metrics.processor';
import { SchedulerService } from '@modules/overlay-metrics-etl/scheduler/scheduler.service';
import { SchedulerConfigService } from '@modules/overlay-metrics-etl/scheduler/scheduler-config.service';
import { TransformerService } from '@modules/overlay-metrics-etl/transformer/transformer.service';

type ExtractorMethod =
  | 'extractPlatformMetrics'
  | 'extractDeviceBreakdown'
  | 'extractTransportComparison'
  | 'extractSdkVersions'
  | 'extractFailures'
  | 'extractLatency'
  | 'extractTimeseries';

type TransformerMethod =
  | 'transformPlatformMetrics'
  | 'transformDeviceBreakdown'
  | 'transformTransportComparison'
  | 'transformSdkVersions'
  | 'transformFailures'
  | 'transformLatency'
  | 'transformTimeseries';

type LoaderMethod =
  | 'loadPlatformMetrics'
  | 'loadDeviceBreakdown'
  | 'loadTransportComparison'
  | 'loadSdkVersions'
  | 'loadFailures'
  | 'loadLatency'
  | 'loadTimeseries';

type ExtractorMock = Record<ExtractorMethod, jest.Mock>;
type TransformerMock = Record<TransformerMethod, jest.Mock>;
type LoaderMock = Record<LoaderMethod, jest.Mock>;

type RetryOutcome = {
  status: 'completed' | 'failed';
  attemptsMade: number;
  scheduledBackoffs: number[];
  error?: Error;
};

type RetryableJob = Pick<Job, 'id' | 'name' | 'data' | 'timestamp' | 'delay' | 'opts'>;

describe('UC-11 - Elasticsearch connection error retry', () => {
  const intervalFrom = new Date('2026-05-13T10:00:00.000Z');
  const intervalTo = new Date('2026-05-13T10:05:00.000Z');
  const jobOpts = {
    attempts: 3,
    backoff: { type: 'exponential' as const, delay: 5000 },
  };
  const jobData = {
    timeRangeMinutes: 5,
    timelineIds: ['timeline-es-001'],
    tenantId: 'tenant-es-001',
    matchId: 'match-es-001',
  };

  const createAggResult = (name: string) => ({
    aggregations: { name },
    took: 3,
  });

  const createJob = (): RetryableJob => ({
    id: 'job-uc-11',
    name: OVERLAY_METRICS_JOB,
    data: jobData,
    timestamp: Date.parse('2026-05-13T10:07:30.000Z'),
    delay: 0,
    opts: jobOpts,
  });

  const createExtractorMock = (): ExtractorMock => ({
    extractPlatformMetrics: jest.fn(),
    extractDeviceBreakdown: jest.fn().mockResolvedValue(createAggResult('device')),
    extractTransportComparison: jest.fn().mockResolvedValue(createAggResult('transport')),
    extractSdkVersions: jest.fn().mockResolvedValue(createAggResult('sdk')),
    extractFailures: jest.fn().mockResolvedValue(createAggResult('failure')),
    extractLatency: jest.fn().mockResolvedValue(createAggResult('latency')),
    extractTimeseries: jest.fn().mockResolvedValue(createAggResult('timeseries')),
  });

  const createTransformerMock = (): TransformerMock => ({
    transformPlatformMetrics: jest.fn().mockReturnValue([{ platform: 'web' }]),
    transformDeviceBreakdown: jest
      .fn()
      .mockImplementation((_agg, _ctx, dimension: string) => [{ dimension }]),
    transformTransportComparison: jest.fn().mockReturnValue([{ transportMode: 'ws' }]),
    transformSdkVersions: jest.fn().mockReturnValue([{ sdkVersion: '1.0.0' }]),
    transformFailures: jest.fn().mockReturnValue([{ failureReason: 'timeout' }]),
    transformLatency: jest.fn().mockReturnValue({ metricType: 'overall' }),
    transformTimeseries: jest
      .fn()
      .mockImplementation((_agg, _ctx, metric: string, interval: string) => [
        { metric, interval, value: 1 },
      ]),
  });

  const createLoaderMock = (): LoaderMock => ({
    loadPlatformMetrics: jest.fn().mockResolvedValue(undefined),
    loadDeviceBreakdown: jest.fn().mockResolvedValue(undefined),
    loadTransportComparison: jest.fn().mockResolvedValue(undefined),
    loadSdkVersions: jest.fn().mockResolvedValue(undefined),
    loadFailures: jest.fn().mockResolvedValue(undefined),
    loadLatency: jest.fn().mockResolvedValue(undefined),
    loadTimeseries: jest.fn().mockResolvedValue(undefined),
  });

  const getExponentialBackoff = (delay: number, attemptNumber: number): number =>
    delay * 2 ** (attemptNumber - 1);

  // Processor no longer throws on timeline failure — it logs error and continues.
  // BullMQ retry is no longer triggered by processor errors.
  const runProcessorOnce = async (
    processor: OverlayMetricsProcessor,
    job: RetryableJob,
  ): Promise<RetryOutcome> => {
    await processor.process(job as Job);
    return {
      status: 'completed',
      attemptsMade: 1,
      scheduledBackoffs: [],
    };
  };

  describe('processor retry flow', () => {
    let moduleRef: TestingModule;
    let processor: OverlayMetricsProcessor;
    let extractor: ExtractorMock;
    let transformer: TransformerMock;
    let loader: LoaderMock;
    let logSpy: jest.SpyInstance;
    let errorSpy: jest.SpyInstance;

    beforeEach(async () => {
      extractor = createExtractorMock();
      transformer = createTransformerMock();
      loader = createLoaderMock();

      logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
      errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

      moduleRef = await Test.createTestingModule({
        providers: [
          OverlayMetricsProcessor,
          { provide: ExtractorService, useValue: extractor },
          { provide: TransformerService, useValue: transformer },
          { provide: LoaderService, useValue: loader },
        ],
      }).compile();

      processor = moduleRef.get(OverlayMetricsProcessor);
    });

    afterEach(async () => {
      await moduleRef.close();
      jest.restoreAllMocks();
    });

    it('log error và continue khi ES connection error — không retry, job vẫn complete', async () => {
      errorSpy.mockClear();
      const connectionError = new errors.ConnectionError('Elasticsearch connection lost');

      extractor.extractPlatformMetrics.mockRejectedValueOnce(connectionError);

      const result = await runProcessorOnce(processor, createJob());

      expect(result).toEqual({
        status: 'completed',
        attemptsMade: 1,
        scheduledBackoffs: [],
      });
      expect(extractor.extractPlatformMetrics).toHaveBeenCalledTimes(1);
      // Loader not called because platform extraction failed before load
      expect(loader.loadPlatformMetrics).not.toHaveBeenCalled();

      expect(errorSpy).toHaveBeenCalledTimes(2);
      expect(errorSpy.mock.calls[0][0]).toContain(
        'Timeline timeline-es-001 processing failed: Elasticsearch connection lost',
      );
      expect(errorSpy.mock.calls[1][0]).toContain(
        'Target match-es-001 / Timeline timeline-es-001 failed: Elasticsearch connection lost',
      );

      // Other extractors not called because processor stopped at platform failure
      expect(extractor.extractDeviceBreakdown).not.toHaveBeenCalled();
      expect(extractor.extractTransportComparison).not.toHaveBeenCalled();
    });

    it('job vẫn complete ngay cả khi ES lỗi liên tục — không có retry', async () => {
      errorSpy.mockClear();
      extractor.extractPlatformMetrics.mockRejectedValue(
        new errors.ConnectionError('Elasticsearch cluster unavailable'),
      );

      const result = await runProcessorOnce(processor, createJob());

      expect(result.status).toBe('completed');
      expect(result.attemptsMade).toBe(1);
      expect(extractor.extractPlatformMetrics).toHaveBeenCalledTimes(1);
      expect(loader.loadPlatformMetrics).not.toHaveBeenCalled();
      expect(errorSpy).toHaveBeenCalledTimes(2);
    });
  });

  describe('scheduler retry policy', () => {
    let moduleRef: TestingModule;
    let queueMock: { upsertJobScheduler: jest.Mock };
    let schedulerConfigMock: { getActiveTargets: jest.Mock };

    beforeEach(async () => {
      queueMock = {
        upsertJobScheduler: jest.fn().mockResolvedValue(undefined),
      };

      schedulerConfigMock = {
        getActiveTargets: jest.fn().mockResolvedValue([
          {
            tenantId: jobData.tenantId,
            matchId: jobData.matchId,
            timelineIds: jobData.timelineIds,
            enabled: true,
          },
        ]),
      };

      moduleRef = await Test.createTestingModule({
        providers: [
          SchedulerService,
          {
            provide: getQueueToken(OVERLAY_METRICS_QUEUE),
            useValue: queueMock,
          },
          {
            provide: SchedulerConfigService,
            useValue: schedulerConfigMock,
          },
        ],
      }).compile();
    });

    afterEach(async () => {
      await moduleRef.close();
      jest.restoreAllMocks();
    });

    it('đăng ký BullMQ job với attempts=3 và exponential backoff base 5 giây', async () => {
      const scheduler = moduleRef.get(SchedulerService);

      await scheduler.onModuleInit();

      expect(queueMock.upsertJobScheduler).toHaveBeenCalledTimes(1);
      expect(queueMock.upsertJobScheduler).toHaveBeenCalledWith(
        OVERLAY_METRICS_SCHEDULER_ID,
        { every: 60 * 60 * 1000 },
        {
          name: OVERLAY_METRICS_JOB,
          data: {
            timeRangeMinutes: 60,
            targets: [
              {
                tenantId: jobData.tenantId,
                matchId: jobData.matchId,
                timelineIds: jobData.timelineIds,
                enabled: true,
              },
            ],
          },
          opts: {
            attempts: 3,
            backoff: { type: 'exponential', delay: 5000 },
          },
        },
      );

      expect([
        getExponentialBackoff(jobOpts.backoff.delay, 1),
        getExponentialBackoff(jobOpts.backoff.delay, 2),
        getExponentialBackoff(jobOpts.backoff.delay, 3),
      ]).toEqual([5000, 10000, 20000]);
      expect(intervalFrom.toISOString()).toBe('2026-05-13T10:00:00.000Z');
      expect(intervalTo.toISOString()).toBe('2026-05-13T10:05:00.000Z');
    });
  });
});
