import { Logger } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { TimelineProcessorService } from '@modules/overlay-metrics-etl/kafka/timeline-processor.service';
import { METRIC_PIPELINES } from '@modules/overlay-metrics-etl/pipelines/pipelines.module';
import type { MetricPipeline } from '@modules/overlay-metrics-etl/pipelines/metric-pipeline.interface';
import { MetricType } from '@domain/enums/metric-type.enum';

describe('UC-15 - Throw khi payload thiếu required fields', () => {
  let moduleRef: TestingModule;
  let timelineProcessor: TimelineProcessorService;
  let mockPipelines: MetricPipeline[];
  let warnSpy: jest.SpyInstance;
  let logSpy: jest.SpyInstance;

  const validPayload = {
    timeRangeMinutes: 5,
    timelineId: 'tl-1',
    tenantId: 't1',
    matchId: 'match-1',
  };
  const skipCases: Array<{ name: string; data: Record<string, unknown> }> = [
    {
      name: 'throw khi thiếu cả timelineId và tenantId',
      data: { timeRangeMinutes: 5 },
    },
    {
      name: 'throw khi thiếu timelineId',
      data: { timeRangeMinutes: 5, tenantId: 't1', matchId: 'match-1' },
    },
    {
      name: 'throw khi thiếu tenantId',
      data: { timeRangeMinutes: 5, timelineId: 'tl-1', matchId: 'match-1' },
    },
    {
      name: 'throw khi timelineId rỗng',
      data: {
        timeRangeMinutes: 5,
        timelineId: '',
        tenantId: 't1',
        matchId: 'match-1',
      },
    },
  ];

  const expectNoPipelineCalls = (): void => {
    mockPipelines.forEach((pipeline) => {
      expect(pipeline.execute).not.toHaveBeenCalled();
    });
  };

  beforeEach(async () => {
    warnSpy = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    logSpy = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);

    mockPipelines = [
      MetricType.PLATFORM,
      MetricType.DEVICE,
      MetricType.TRANSPORT,
      MetricType.SDK,
      MetricType.FAILURE,
      MetricType.TIMESERIES,
      MetricType.LATENCY,
    ].map((type) => ({
      type,
      execute: jest.fn().mockResolvedValue(undefined),
    }));

    moduleRef = await Test.createTestingModule({
      providers: [
        TimelineProcessorService,
        { provide: METRIC_PIPELINES, useValue: mockPipelines },
      ],
    }).compile();

    timelineProcessor = moduleRef.get(TimelineProcessorService);
    warnSpy.mockClear();
    logSpy.mockClear();
  });

  afterEach(async () => {
    await moduleRef.close();
    jest.restoreAllMocks();
  });

  it.each(skipCases)('$name', async ({ data }) => {
    await expect(
      timelineProcessor.processTimeline(data as any),
    ).rejects.toThrow(
      'Invalid timeline payload: missing tenantId, matchId, timelineId, or timeRangeMinutes',
    );

    expectNoPipelineCalls();
  });

  it('process khi payload có timelineId, tenantId và matchId hợp lệ', async () => {
    await expect(
      timelineProcessor.processTimeline(validPayload),
    ).resolves.toBeUndefined();

    mockPipelines.forEach((pipeline) => {
      expect(pipeline.execute).toHaveBeenCalledTimes(1);
    });
  });
});
