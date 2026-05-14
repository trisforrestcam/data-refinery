import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import type { Job } from 'bullmq';
import { ExtractorService } from '@modules/overlay-metrics-etl/extractor/extractor.service';
import { LoaderService } from '@modules/overlay-metrics-etl/loader/loader.service';
import { OVERLAY_METRICS_JOB } from '@common/constants/scheduler.constants';
import { OverlayMetricsProcessor } from '@modules/overlay-metrics-etl/scheduler/processors/overlay-metrics.processor';
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

describe('UC-15 - Skip job khi thiếu timelineIds hoặc tenantId', () => {
  let moduleRef: TestingModule;
  let processor: OverlayMetricsProcessor;
  let extractor: ExtractorMock;
  let transformer: TransformerMock;
  let loader: LoaderMock;
  let warnSpy: jest.SpyInstance;
  let logSpy: jest.SpyInstance;

  const missingRequiredDataWarn =
    'No valid targets or timelineIds provided, skipping';
  const validJobData = {
    timeRangeMinutes: 5,
    timelineIds: ['tl-1'],
    tenantId: 't1',
    matchId: 'match-1',
  };
  const skipCases: Array<{ name: string; data: Record<string, unknown> }> = [
    {
      name: 'skip khi thiếu cả timelineIds và tenantId',
      data: { timeRangeMinutes: 5 },
    },
    {
      name: 'skip khi thiếu timelineIds',
      data: { timeRangeMinutes: 5, tenantId: 't1' },
    },
    {
      name: 'skip khi thiếu tenantId',
      data: { timeRangeMinutes: 5, timelineIds: ['tl-1'] },
    },
    {
      name: 'skip khi timelineIds rỗng',
      data: { timeRangeMinutes: 5, timelineIds: [], tenantId: 't1' },
    },
  ];

  const makeJob = (
    data: Record<string, unknown>,
    name: string = OVERLAY_METRICS_JOB,
  ): Job =>
    ({
      id: `${name}-job-uc-15`,
      name,
      timestamp: Date.parse('2026-05-13T10:07:30.000Z'),
      data,
    }) as Job;

  const expectNoPipelineCalls = (): void => {
    Object.values(extractor).forEach((mock) => {
      expect(mock).not.toHaveBeenCalled();
    });
    Object.values(transformer).forEach((mock) => {
      expect(mock).not.toHaveBeenCalled();
    });
    Object.values(loader).forEach((mock) => {
      expect(mock).not.toHaveBeenCalled();
    });
  };

  beforeEach(async () => {
    warnSpy = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    logSpy = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);

    extractor = {
      extractPlatformMetrics: jest
        .fn()
        .mockResolvedValue({ aggregations: { kind: 'platform' } }),
      extractDeviceBreakdown: jest
        .fn()
        .mockResolvedValue({ aggregations: { kind: 'device' } }),
      extractTransportComparison: jest
        .fn()
        .mockResolvedValue({ aggregations: { kind: 'transport' } }),
      extractSdkVersions: jest
        .fn()
        .mockResolvedValue({ aggregations: { kind: 'sdk' } }),
      extractFailures: jest
        .fn()
        .mockResolvedValue({ aggregations: { kind: 'failures' } }),
      extractLatency: jest
        .fn()
        .mockResolvedValue({ aggregations: { kind: 'latency' } }),
      extractTimeseries: jest
        .fn()
        .mockResolvedValue({ aggregations: { kind: 'timeseries' } }),
    };

    transformer = {
      transformPlatformMetrics: jest.fn().mockReturnValue([]),
      transformDeviceBreakdown: jest.fn().mockReturnValue([]),
      transformTransportComparison: jest.fn().mockReturnValue([]),
      transformSdkVersions: jest.fn().mockReturnValue([]),
      transformFailures: jest.fn().mockReturnValue([]),
      transformLatency: jest.fn().mockReturnValue({ metricType: 'overall' }),
      transformTimeseries: jest.fn().mockReturnValue([]),
    };

    loader = {
      loadPlatformMetrics: jest.fn().mockResolvedValue(undefined),
      loadDeviceBreakdown: jest.fn().mockResolvedValue(undefined),
      loadTransportComparison: jest.fn().mockResolvedValue(undefined),
      loadSdkVersions: jest.fn().mockResolvedValue(undefined),
      loadFailures: jest.fn().mockResolvedValue(undefined),
      loadLatency: jest.fn().mockResolvedValue(undefined),
      loadTimeseries: jest.fn().mockResolvedValue(undefined),
    };

    moduleRef = await Test.createTestingModule({
      providers: [
        OverlayMetricsProcessor,
        { provide: ExtractorService, useValue: extractor },
        { provide: TransformerService, useValue: transformer },
        { provide: LoaderService, useValue: loader },
      ],
    }).compile();

    processor = moduleRef.get(OverlayMetricsProcessor);
    warnSpy.mockClear();
    logSpy.mockClear();
  });

  afterEach(async () => {
    await moduleRef.close();
    jest.restoreAllMocks();
  });

  it.each(skipCases)('$name', async ({ data }) => {
    await expect(processor.process(makeJob(data))).resolves.toBeUndefined();

    expect(warnSpy).toHaveBeenCalledWith(missingRequiredDataWarn);
    expectNoPipelineCalls();
    expect(logSpy).toHaveBeenCalledWith(
      `Processing job ${OVERLAY_METRICS_JOB}-job-uc-15`,
    );
  });

  it('process khi job có timelineIds và tenantId hợp lệ', async () => {
    await expect(processor.process(makeJob(validJobData))).resolves.toBeUndefined();

    expect(warnSpy).not.toHaveBeenCalledWith(missingRequiredDataWarn);
    expect(extractor.extractPlatformMetrics).toHaveBeenCalledTimes(1);
    expect(loader.loadPlatformMetrics).toHaveBeenCalledTimes(1);
    expect(extractor.extractTimeseries).toHaveBeenCalledTimes(5);
    expect(loader.loadTimeseries).toHaveBeenCalledTimes(5);
  });

  it('log warn và return khi nhận unknown job name', async () => {
    const unknownJobName = 'unknown-job-name';

    await expect(
      processor.process(makeJob(validJobData, unknownJobName)),
    ).resolves.toBeUndefined();

    expect(warnSpy).toHaveBeenCalledWith(
      `Unknown job name: ${unknownJobName}`,
    );
    expectNoPipelineCalls();
    expect(logSpy).not.toHaveBeenCalled();
  });
});
