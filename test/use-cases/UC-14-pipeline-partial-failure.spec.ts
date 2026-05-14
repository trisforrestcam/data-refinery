import { Logger } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import type { Job } from 'bullmq';
import { OVERLAY_METRICS_JOB } from '@common/constants/scheduler.constants';
import { ExtractorService } from '@modules/overlay-metrics-etl/extractor/extractor.service';
import { LoaderService } from '@modules/overlay-metrics-etl/loader/loader.service';
import { OverlayMetricsProcessor } from '@modules/overlay-metrics-etl/scheduler/processors/overlay-metrics.processor';
import { TransformerService } from '@modules/overlay-metrics-etl/transformer/transformer.service';
import type { TransformContext } from '@common/interfaces/transform-context.interface';

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
type FailureScenario = 'device' | 'sdk' | 'timeseries';

type MongoState = {
  platform: Record<string, unknown>[];
  device: Record<string, unknown>[];
  transport: Record<string, unknown>[];
  sdk: Record<string, unknown>[];
  failures: Record<string, unknown>[];
  latency: Record<string, unknown>[];
  timeseries: Record<string, unknown>[];
};

type ScenarioContext = {
  moduleRef: TestingModule;
  processor: OverlayMetricsProcessor;
  extractor: ExtractorMock;
  loader: LoaderMock;
  mongoState: MongoState;
};

describe('UC-14 - Pipeline partial failure: log error và continue, không retry cả job', () => {
  const intervalFrom = new Date('2026-05-13T10:00:00.000Z');
  const intervalTo = new Date('2026-05-13T10:05:00.000Z');
  const timelineId = 'timeline-partial-001';
  const tenantId = 'tenant-001';
  const matchId = 'match-001';

  let logSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;

  const aggResult = (name: string) => ({
    aggregations: { name },
  });

  const buildJob = (id: string): Job =>
    ({
      id,
      name: OVERLAY_METRICS_JOB,
      timestamp: Date.parse('2026-05-13T10:05:00.000Z'),
      data: {
        timeRangeMinutes: 5,
        timelineIds: [timelineId],
        tenantId,
        matchId,
        intervalFrom,
        intervalTo,
      },
    }) as Job;

  const createMongoState = (): MongoState => ({
    platform: [],
    device: [],
    transport: [],
    sdk: [],
    failures: [],
    latency: [],
    timeseries: [],
  });

  const createTransformer = (): TransformerMock => ({
    transformPlatformMetrics: jest
      .fn()
      .mockImplementation((_aggregations: unknown, ctx: TransformContext) => [
        {
          tenantId: ctx.tenantId,
          timelineId: ctx.timelineId,
          matchId: ctx.matchId,
          platform: 'web',
          intervalFrom: ctx.intervalFrom,
          intervalTo: ctx.intervalTo,
        },
      ]),
    transformDeviceBreakdown: jest
      .fn()
      .mockImplementation(
        (_aggregations: unknown, ctx: TransformContext, dimension: string) => [
          {
            tenantId: ctx.tenantId,
            timelineId: ctx.timelineId,
            matchId: ctx.matchId,
            dimension,
            bucketKey: `${dimension}-bucket`,
            intervalFrom: ctx.intervalFrom,
            intervalTo: ctx.intervalTo,
          },
        ],
      ),
    transformTransportComparison: jest
      .fn()
      .mockImplementation((_aggregations: unknown, ctx: TransformContext) => [
        {
          tenantId: ctx.tenantId,
          timelineId: ctx.timelineId,
          matchId: ctx.matchId,
          transportMode: 'wsInteractive',
          intervalFrom: ctx.intervalFrom,
          intervalTo: ctx.intervalTo,
        },
      ]),
    transformSdkVersions: jest
      .fn()
      .mockImplementation((_aggregations: unknown, ctx: TransformContext) => [
        {
          tenantId: ctx.tenantId,
          timelineId: ctx.timelineId,
          matchId: ctx.matchId,
          sdkVersion: '2.1.0',
          intervalFrom: ctx.intervalFrom,
          intervalTo: ctx.intervalTo,
        },
      ]),
    transformFailures: jest
      .fn()
      .mockImplementation((_aggregations: unknown, ctx: TransformContext) => [
        {
          tenantId: ctx.tenantId,
          timelineId: ctx.timelineId,
          matchId: ctx.matchId,
          failureReason: 'timeout',
          failureStep: 'render',
          intervalFrom: ctx.intervalFrom,
          intervalTo: ctx.intervalTo,
        },
      ]),
    transformLatency: jest
      .fn()
      .mockImplementation((_aggregations: unknown, ctx: TransformContext) => ({
        tenantId: ctx.tenantId,
        timelineId: ctx.timelineId,
        matchId: ctx.matchId,
        intervalFrom: ctx.intervalFrom,
        intervalTo: ctx.intervalTo,
        receive: { p50: 10, p75: 12, p95: 15, p99: 18, avg: 11, max: 20 },
        render: { p50: 20, p75: 25, p95: 30, p99: 35, avg: 24, max: 40 },
        ack: { p50: 1, p75: 1.5, p95: 2, p99: 3, avg: 1.2, max: 4 },
        renderDuration: { p50: 30, p95: 40, p99: 50, avg: 35 },
      })),
    transformTimeseries: jest
      .fn()
      .mockImplementation(
        (_aggregations: unknown, ctx: TransformContext, metric: string) => [
          {
            tenantId: ctx.tenantId,
            timelineId: ctx.timelineId,
            matchId: ctx.matchId,
            metric,
            interval: '5m',
            time: ctx.intervalFrom,
            value: 100,
          },
        ],
      ),
  });

  const createExtractor = (scenario: FailureScenario): ExtractorMock => ({
    extractPlatformMetrics: jest.fn().mockResolvedValue(aggResult('platform')),
    extractDeviceBreakdown: jest
      .fn()
      .mockImplementation(async (_query: unknown, _dimension: string) => {
        if (scenario === 'device') {
          throw new Error('Step 2 (Device) extractor failed');
        }
        return aggResult('device');
      }),
    extractTransportComparison: jest
      .fn()
      .mockResolvedValue(aggResult('transport')),
    extractSdkVersions: jest.fn().mockImplementation(async () => {
      if (scenario === 'sdk') {
        throw new Error('Step 4 (SDK) extractor failed');
      }
      return aggResult('sdk');
    }),
    extractFailures: jest.fn().mockResolvedValue(aggResult('failures')),
    extractLatency: jest.fn().mockResolvedValue(aggResult('latency')),
    extractTimeseries: jest
      .fn()
      .mockImplementation(async (_query: unknown, metric: string) => {
        if (scenario === 'timeseries' && metric === 'avgRenderMs') {
          throw new Error('Step 7 (Timeseries) extractor failed at avgRenderMs');
        }
        return aggResult(`timeseries-${metric}`);
      }),
  });

  const createLoader = (mongoState: MongoState): LoaderMock => ({
    loadPlatformMetrics: jest.fn().mockImplementation(async (items: Record<string, unknown>[]) => {
      mongoState.platform.push(...items);
    }),
    loadDeviceBreakdown: jest.fn().mockImplementation(async (items: Record<string, unknown>[]) => {
      mongoState.device.push(...items);
    }),
    loadTransportComparison: jest.fn().mockImplementation(async (items: Record<string, unknown>[]) => {
      mongoState.transport.push(...items);
    }),
    loadSdkVersions: jest.fn().mockImplementation(async (items: Record<string, unknown>[]) => {
      mongoState.sdk.push(...items);
    }),
    loadFailures: jest.fn().mockImplementation(async (items: Record<string, unknown>[]) => {
      mongoState.failures.push(...items);
    }),
    loadLatency: jest.fn().mockImplementation(async (items: Record<string, unknown>[]) => {
      mongoState.latency.push(...items);
    }),
    loadTimeseries: jest.fn().mockImplementation(async (items: Record<string, unknown>[]) => {
      mongoState.timeseries.push(...items);
    }),
  });

  const setupScenario = async (scenario: FailureScenario): Promise<ScenarioContext> => {
    const mongoState = createMongoState();
    const extractor = createExtractor(scenario);
    const transformer = createTransformer();
    const loader = createLoader(mongoState);

    const moduleRef = await Test.createTestingModule({
      providers: [
        OverlayMetricsProcessor,
        { provide: ExtractorService, useValue: extractor },
        { provide: TransformerService, useValue: transformer },
        { provide: LoaderService, useValue: loader },
      ],
    }).compile();

    return {
      moduleRef,
      processor: moduleRef.get(OverlayMetricsProcessor),
      extractor,
      loader,
      mongoState,
    };
  };

  const lastErrorMessage = (): string => {
    const lastCall = errorSpy.mock.calls.at(-1);
    return typeof lastCall?.[0] === 'string' ? lastCall[0] : '';
  };

  beforeEach(() => {
    logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('giữ data của steps 1-3 và dừng steps 5-7 khi step 4 SDK fail, job vẫn resolve', async () => {
    const ctx = await setupScenario('sdk');

    // Processor no longer throws — it logs error and continues
    await expect(ctx.processor.process(buildJob('job-uc-14-sdk'))).resolves.toBeUndefined();

    expect(ctx.loader.loadPlatformMetrics).toHaveBeenCalledTimes(1);
    expect(ctx.loader.loadDeviceBreakdown).toHaveBeenCalledTimes(3);
    expect(ctx.loader.loadTransportComparison).toHaveBeenCalledTimes(1);
    expect(ctx.loader.loadSdkVersions).not.toHaveBeenCalled();

    expect(ctx.extractor.extractFailures).not.toHaveBeenCalled();
    expect(ctx.extractor.extractLatency).not.toHaveBeenCalled();
    expect(ctx.extractor.extractTimeseries).not.toHaveBeenCalled();

    expect(ctx.mongoState.platform).toHaveLength(1);
    expect(ctx.mongoState.device).toHaveLength(3);
    expect(ctx.mongoState.transport).toHaveLength(1);
    expect(ctx.mongoState.sdk).toHaveLength(0);
    expect(ctx.mongoState.failures).toHaveLength(0);
    expect(ctx.mongoState.latency).toHaveLength(0);
    expect(ctx.mongoState.timeseries).toHaveLength(0);

    expect(lastErrorMessage()).toContain('Step 4 (SDK) extractor failed');
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('completed with 1 failed timelines'),
    );

    await ctx.moduleRef.close();
  });

  it('fail ở step 2 Device thì chỉ step 1 đã commit, job vẫn resolve', async () => {
    const ctx = await setupScenario('device');

    await expect(ctx.processor.process(buildJob('job-uc-14-device'))).resolves.toBeUndefined();

    expect(ctx.loader.loadPlatformMetrics).toHaveBeenCalledTimes(1);
    expect(ctx.loader.loadDeviceBreakdown).not.toHaveBeenCalled();
    expect(ctx.loader.loadTransportComparison).not.toHaveBeenCalled();
    expect(ctx.loader.loadSdkVersions).not.toHaveBeenCalled();
    expect(ctx.loader.loadFailures).not.toHaveBeenCalled();
    expect(ctx.loader.loadLatency).not.toHaveBeenCalled();
    expect(ctx.loader.loadTimeseries).not.toHaveBeenCalled();

    expect(ctx.extractor.extractDeviceBreakdown).toHaveBeenCalledTimes(1);
    expect(ctx.extractor.extractTransportComparison).not.toHaveBeenCalled();
    expect(ctx.extractor.extractSdkVersions).not.toHaveBeenCalled();
    expect(ctx.extractor.extractFailures).not.toHaveBeenCalled();
    expect(ctx.extractor.extractLatency).not.toHaveBeenCalled();
    expect(ctx.extractor.extractTimeseries).not.toHaveBeenCalled();

    expect(ctx.mongoState.platform).toHaveLength(1);
    expect(ctx.mongoState.device).toHaveLength(0);
    expect(ctx.mongoState.transport).toHaveLength(0);
    expect(ctx.mongoState.sdk).toHaveLength(0);
    expect(ctx.mongoState.failures).toHaveLength(0);
    expect(ctx.mongoState.latency).toHaveLength(0);
    expect(ctx.mongoState.timeseries).toHaveLength(0);

    expect(lastErrorMessage()).toContain('Step 2 (Device) extractor failed');

    await ctx.moduleRef.close();
  });

  it('fail ở step 7 Timeseries cuối thì data các step trước vẫn giữ nguyên, job resolve', async () => {
    const ctx = await setupScenario('timeseries');

    await expect(ctx.processor.process(buildJob('job-uc-14-timeseries'))).resolves.toBeUndefined();

    expect(ctx.loader.loadPlatformMetrics).toHaveBeenCalledTimes(1);
    expect(ctx.loader.loadDeviceBreakdown).toHaveBeenCalledTimes(3);
    expect(ctx.loader.loadTransportComparison).toHaveBeenCalledTimes(1);
    expect(ctx.loader.loadSdkVersions).toHaveBeenCalledTimes(1);
    expect(ctx.loader.loadFailures).toHaveBeenCalledTimes(1);
    expect(ctx.loader.loadLatency).toHaveBeenCalledTimes(1);
    expect(ctx.loader.loadTimeseries).toHaveBeenCalledTimes(4);

    expect(ctx.extractor.extractTimeseries).toHaveBeenCalledTimes(5);
    expect(ctx.extractor.extractTimeseries).toHaveBeenNthCalledWith(
      5,
      {
        timelineIds: [timelineId],
        tenantId,
        from: intervalFrom,
        to: intervalTo,
      },
      'avgRenderMs',
      '5m',
    );

    expect(ctx.mongoState.platform).toHaveLength(1);
    expect(ctx.mongoState.device).toHaveLength(3);
    expect(ctx.mongoState.transport).toHaveLength(1);
    expect(ctx.mongoState.sdk).toHaveLength(1);
    expect(ctx.mongoState.failures).toHaveLength(1);
    expect(ctx.mongoState.latency).toHaveLength(1);
    expect(ctx.mongoState.timeseries).toHaveLength(4);
    expect(ctx.mongoState.timeseries.map((item) => item.metric)).toEqual([
      'sent',
      'received',
      'rendered',
      'failed',
    ]);

    expect(lastErrorMessage()).toContain('Step 7 (Timeseries) extractor failed at avgRenderMs');

    await ctx.moduleRef.close();
  });
});
