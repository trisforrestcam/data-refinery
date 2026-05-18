import { Logger } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { TimelineProcessorService } from '@modules/overlay-metrics-etl/kafka/timeline-processor.service';
import { METRIC_PIPELINES } from '@modules/overlay-metrics-etl/pipelines/pipelines.module';
import type { MetricPipeline } from '@modules/overlay-metrics-etl/pipelines/metric-pipeline.interface';
import { MetricType } from '@domain/enums/metric-type.enum';

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
  timelineProcessor: TimelineProcessorService;
  mongoState: MongoState;
};

describe('UC-14 - Pipeline partial failure: log error và throw để consumer retry/DLQ', () => {
  const intervalFrom = new Date('2026-05-13T10:00:00.000Z');
  const intervalTo = new Date('2026-05-13T10:05:00.000Z');
  const timelineId = 'timeline-partial-001';
  const tenantId = 'tenant-001';
  const matchId = 'match-001';

  let logSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;

  const buildPayload = () => ({
    tenantId,
    matchId,
    timelineId,
    timeRangeMinutes: 5,
    intervalFrom: intervalFrom.toISOString(),
    intervalTo: intervalTo.toISOString(),
  });

  const createMongoState = (): MongoState => ({
    platform: [],
    device: [],
    transport: [],
    sdk: [],
    failures: [],
    latency: [],
    timeseries: [],
  });

  const createMockPipelines = (
    scenario: FailureScenario,
    mongoState: MongoState,
  ): MetricPipeline[] => [
    {
      type: MetricType.PLATFORM,
      execute: jest.fn().mockImplementation(async () => {
        mongoState.platform.push({
          tenantId,
          timelineId,
          matchId,
          platform: 'web',
          intervalFrom,
          intervalTo,
        });
      }),
    },
    {
      type: MetricType.DEVICE,
      execute: jest.fn().mockImplementation(async () => {
        if (scenario === 'device') {
          throw new Error('Step 2 (Device) extractor failed');
        }
        mongoState.device.push(
          {
            tenantId,
            timelineId,
            matchId,
            dimension: 'browser',
            bucketKey: 'browser-bucket',
            intervalFrom,
            intervalTo,
          },
          {
            tenantId,
            timelineId,
            matchId,
            dimension: 'os',
            bucketKey: 'os-bucket',
            intervalFrom,
            intervalTo,
          },
          {
            tenantId,
            timelineId,
            matchId,
            dimension: 'deviceClass',
            bucketKey: 'deviceClass-bucket',
            intervalFrom,
            intervalTo,
          },
        );
      }),
    },
    {
      type: MetricType.TRANSPORT,
      execute: jest.fn().mockImplementation(async () => {
        mongoState.transport.push({
          tenantId,
          timelineId,
          matchId,
          transportMode: 'wsInteractive',
          intervalFrom,
          intervalTo,
        });
      }),
    },
    {
      type: MetricType.SDK,
      execute: jest.fn().mockImplementation(async () => {
        if (scenario === 'sdk') {
          throw new Error('Step 4 (SDK) extractor failed');
        }
        mongoState.sdk.push({
          tenantId,
          timelineId,
          matchId,
          sdkVersion: '2.1.0',
          intervalFrom,
          intervalTo,
        });
      }),
    },
    {
      type: MetricType.FAILURE,
      execute: jest.fn().mockImplementation(async () => {
        mongoState.failures.push({
          tenantId,
          timelineId,
          matchId,
          failureReason: 'timeout',
          failureStep: 'render',
          intervalFrom,
          intervalTo,
        });
      }),
    },
    {
      type: MetricType.LATENCY,
      execute: jest.fn().mockImplementation(async () => {
        mongoState.latency.push({
          tenantId,
          timelineId,
          matchId,
          intervalFrom,
          intervalTo,
          receive: { p50: 10, p75: 12, p95: 15, p99: 18, avg: 11, max: 20 },
          render: { p50: 20, p75: 25, p95: 30, p99: 35, avg: 24, max: 40 },
          ack: { p50: 1, p75: 1.5, p95: 2, p99: 3, avg: 1.2, max: 4 },
          renderDuration: { p50: 30, p95: 40, p99: 50, avg: 35 },
        });
      }),
    },
    {
      type: MetricType.TIMESERIES,
      execute: jest.fn().mockImplementation(async () => {
        if (scenario === 'timeseries') {
          mongoState.timeseries.push(
            {
              tenantId,
              timelineId,
              matchId,
              metric: 'sent',
              interval: '5m',
              time: intervalFrom,
              value: 100,
            },
            {
              tenantId,
              timelineId,
              matchId,
              metric: 'received',
              interval: '5m',
              time: intervalFrom,
              value: 100,
            },
            {
              tenantId,
              timelineId,
              matchId,
              metric: 'rendered',
              interval: '5m',
              time: intervalFrom,
              value: 100,
            },
            {
              tenantId,
              timelineId,
              matchId,
              metric: 'failed',
              interval: '5m',
              time: intervalFrom,
              value: 100,
            },
          );
          throw new Error(
            'Step 7 (Timeseries) extractor failed at avgRenderMs',
          );
        }
        mongoState.timeseries.push(
          {
            tenantId,
            timelineId,
            matchId,
            metric: 'sent',
            interval: '5m',
            time: intervalFrom,
            value: 100,
          },
          {
            tenantId,
            timelineId,
            matchId,
            metric: 'received',
            interval: '5m',
            time: intervalFrom,
            value: 100,
          },
          {
            tenantId,
            timelineId,
            matchId,
            metric: 'rendered',
            interval: '5m',
            time: intervalFrom,
            value: 100,
          },
          {
            tenantId,
            timelineId,
            matchId,
            metric: 'failed',
            interval: '5m',
            time: intervalFrom,
            value: 100,
          },
          {
            tenantId,
            timelineId,
            matchId,
            metric: 'avgRenderMs',
            interval: '5m',
            time: intervalFrom,
            value: 100,
          },
        );
      }),
    },
  ];

  const setupScenario = async (
    scenario: FailureScenario,
  ): Promise<ScenarioContext> => {
    const mongoState = createMongoState();
    const mockPipelines = createMockPipelines(scenario, mongoState);

    const moduleRef = await Test.createTestingModule({
      providers: [
        TimelineProcessorService,
        { provide: METRIC_PIPELINES, useValue: mockPipelines },
      ],
    }).compile();

    return {
      moduleRef,
      timelineProcessor: moduleRef.get(TimelineProcessorService),
      mongoState,
    };
  };

  const lastErrorMessage = (): string => {
    const lastCall = errorSpy.mock.calls[errorSpy.mock.calls.length - 1];
    return typeof lastCall?.[0] === 'string' ? lastCall[0] : '';
  };

  beforeEach(() => {
    logSpy = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);
    errorSpy = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    warnSpy = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('giữ data của pipelines thành công và throw tổng hợp khi pipeline SDK fail', async () => {
    const ctx = await setupScenario('sdk');

    await expect(
      ctx.timelineProcessor.processTimeline(buildPayload()),
    ).rejects.toThrow(/failed pipelines: sdk/);

    expect(ctx.mongoState.platform).toHaveLength(1);
    expect(ctx.mongoState.device).toHaveLength(3);
    expect(ctx.mongoState.transport).toHaveLength(1);
    expect(ctx.mongoState.sdk).toHaveLength(0);
    expect(ctx.mongoState.failures).toHaveLength(1);
    expect(ctx.mongoState.latency).toHaveLength(1);
    expect(ctx.mongoState.timeseries).toHaveLength(5);

    expect(lastErrorMessage()).toContain('Step 4 (SDK) extractor failed');

    await ctx.moduleRef.close();
  });

  it('fail ở pipeline Device thì platform vẫn persist, throw tổng hợp để consumer retry', async () => {
    const ctx = await setupScenario('device');

    await expect(
      ctx.timelineProcessor.processTimeline(buildPayload()),
    ).rejects.toThrow(/failed pipelines: device/);

    expect(ctx.mongoState.platform).toHaveLength(1);
    expect(ctx.mongoState.device).toHaveLength(0);
    expect(ctx.mongoState.transport).toHaveLength(1);
    expect(ctx.mongoState.sdk).toHaveLength(1);
    expect(ctx.mongoState.failures).toHaveLength(1);
    expect(ctx.mongoState.latency).toHaveLength(1);
    expect(ctx.mongoState.timeseries).toHaveLength(5);

    expect(lastErrorMessage()).toContain('Step 2 (Device) extractor failed');

    await ctx.moduleRef.close();
  });

  it('fail ở pipeline Timeseries cuối thì data các pipeline trước vẫn giữ nguyên, throw tổng hợp để consumer retry', async () => {
    const ctx = await setupScenario('timeseries');

    await expect(
      ctx.timelineProcessor.processTimeline(buildPayload()),
    ).rejects.toThrow(/failed pipelines: timeseries/);

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

    expect(lastErrorMessage()).toContain(
      'Step 7 (Timeseries) extractor failed at avgRenderMs',
    );

    await ctx.moduleRef.close();
  });
});
