import { Logger } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ExtractorService } from '@modules/overlay-metrics-etl/extractor/extractor.service';
import { LoaderService } from '@modules/overlay-metrics-etl/loader/loader.service';
import { TimelineProcessorService } from '@modules/overlay-metrics-etl/kafka/timeline-processor.service';
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

describe('UC-15 - Throw khi payload thiếu required fields', () => {
  let moduleRef: TestingModule;
  let timelineProcessor: TimelineProcessorService;
  let extractor: ExtractorMock;
  let transformer: TransformerMock;
  let loader: LoaderMock;
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
      data: { timeRangeMinutes: 5, timelineId: '', tenantId: 't1', matchId: 'match-1' },
    },
  ];

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
        TimelineProcessorService,
        { provide: ExtractorService, useValue: extractor },
        { provide: TransformerService, useValue: transformer },
        { provide: LoaderService, useValue: loader },
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
    await expect(timelineProcessor.processTimeline(data as any)).rejects.toThrow(
      'Invalid timeline payload: missing tenantId, matchId, timelineId, or timeRangeMinutes',
    );

    expectNoPipelineCalls();
  });

  it('process khi payload có timelineId, tenantId và matchId hợp lệ', async () => {
    await expect(timelineProcessor.processTimeline(validPayload)).resolves.toBeUndefined();

    expect(extractor.extractPlatformMetrics).toHaveBeenCalledTimes(1);
    expect(loader.loadPlatformMetrics).toHaveBeenCalledTimes(1);
    expect(extractor.extractTimeseries).toHaveBeenCalledTimes(5);
    expect(loader.loadTimeseries).toHaveBeenCalledTimes(5);
  });
});
