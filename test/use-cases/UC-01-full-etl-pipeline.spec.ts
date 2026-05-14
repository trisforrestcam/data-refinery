import { Logger } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import type { Job } from 'bullmq';
import { ExtractorService } from '@modules/overlay-metrics-etl/extractor/extractor.service';
import { LoaderService } from '@modules/overlay-metrics-etl/loader/loader.service';
import { OverlayMetricsProcessor } from '@modules/overlay-metrics-etl/scheduler/processors/overlay-metrics.processor';
import { TransformerService } from '@modules/overlay-metrics-etl/transformer/transformer.service';
import type { TransformContext } from '@common/interfaces/transform-context.interface';
import { OVERLAY_METRICS_JOB } from '@common/constants/scheduler.constants';

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

describe('UC-01 - Full ETL pipeline cho 1 trận đấu live', () => {
  let moduleRef: TestingModule;
  let processor: OverlayMetricsProcessor;
  let extractor: ExtractorMock;
  let transformer: TransformerMock;
  let loader: LoaderMock;
  let logSpy: jest.SpyInstance;

  const fixedNow = new Date('2024-01-15T10:05:00.000Z');
  const expectedIntervalFrom = new Date('2024-01-15T10:00:00.000Z');
  const expectedIntervalTo = fixedNow;
  const expectedContext: TransformContext = {
    timelineId: 'tl-001',
    matchId: 'match-123',
    tenantId: 'tenant-abc',
    intervalFrom: expectedIntervalFrom,
    intervalTo: expectedIntervalTo,
  };
  const expectedQuery = {
    timelineIds: ['tl-001'],
    tenantId: 'tenant-abc',
    from: expectedIntervalFrom,
    to: expectedIntervalTo,
  };
  const jobData = {
    timeRangeMinutes: 5,
    timelineIds: ['tl-001'],
    tenantId: 'tenant-abc',
    matchId: 'match-123',
  };
  const liveMatchJob = {
    id: 'job-uc-01',
    name: OVERLAY_METRICS_JOB,
    data: jobData,
    timestamp: fixedNow.getTime(),
  } as Job;

  const aggResult = (name: string) => ({
    aggregations: {
      name,
    },
  });

  const totalCalls = <T extends Record<string, jest.Mock>>(mocks: T): number =>
    Object.values(mocks).reduce((sum, mock) => sum + mock.mock.calls.length, 0);

  const allTransformContexts = (): TransformContext[] => [
    transformer.transformPlatformMetrics.mock.calls[0][1],
    ...transformer.transformDeviceBreakdown.mock.calls.map((call) => call[1]),
    transformer.transformTransportComparison.mock.calls[0][1],
    transformer.transformSdkVersions.mock.calls[0][1],
    transformer.transformFailures.mock.calls[0][1],
    transformer.transformLatency.mock.calls[0][1],
    ...transformer.transformTimeseries.mock.calls.map((call) => call[1]),
  ];

  beforeEach(async () => {
    jest.useFakeTimers().setSystemTime(fixedNow);
    logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);

    extractor = {
      extractPlatformMetrics: jest.fn().mockResolvedValue(aggResult('platform')),
      extractDeviceBreakdown: jest.fn().mockResolvedValue(aggResult('device')),
      extractTransportComparison: jest.fn().mockResolvedValue(aggResult('transport')),
      extractSdkVersions: jest.fn().mockResolvedValue(aggResult('sdk')),
      extractFailures: jest.fn().mockResolvedValue(aggResult('failures')),
      extractLatency: jest.fn().mockResolvedValue(aggResult('latency')),
      extractTimeseries: jest.fn().mockResolvedValue(aggResult('timeseries')),
    };

    transformer = {
      transformPlatformMetrics: jest.fn().mockReturnValue([{ platform: 'web' }]),
      transformDeviceBreakdown: jest
        .fn()
        .mockImplementation((_aggregations, _ctx, dimension: string) => [
          { dimension, bucketKey: `${dimension}-bucket` },
        ]),
      transformTransportComparison: jest
        .fn()
        .mockReturnValue([{ transportMode: 'wsInteractive' }]),
      transformSdkVersions: jest.fn().mockReturnValue([{ sdkVersion: '2.1.0' }]),
      transformFailures: jest
        .fn()
        .mockReturnValue([{ failureReason: 'timeout' }, { failureReason: 'network' }]),
      transformLatency: jest.fn().mockReturnValue({
        metricType: 'overall',
        receive: { p50: 10, p75: 15, p95: 25, p99: 40, avg: 12, max: 50 },
        render: { p50: 50, p75: 75, p95: 120, p99: 200, avg: 60, max: 250 },
        ack: { p50: 2, p75: 3, p95: 5, p99: 10, avg: 2.5, max: 15 },
        renderDuration: { p50: 50, p95: 120, p99: 200, avg: 60 },
      }),
      transformTimeseries: jest
        .fn()
        .mockImplementation((_aggregations, _ctx, metric: string, interval: string) => [
          { metric, interval, value: 100 },
        ]),
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
    logSpy.mockClear();
  });

  afterEach(async () => {
    await moduleRef.close();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('chạy đủ pipeline ETL tổng thể cho 1 timeline của trận live với đúng 13 lượt extract-transform-load', async () => {
    // Nghiệp vụ: 1 job extract-transform-load-metrics xử lý đủ 13 nhánh dữ liệu overlay cho trận live.
    await processor.process(liveMatchJob);

    expect(totalCalls(extractor)).toBe(13);
    expect(totalCalls(transformer)).toBe(13);
    expect(totalCalls(loader)).toBe(13);

    expect(extractor.extractPlatformMetrics).toHaveBeenCalledTimes(1);
    expect(extractor.extractDeviceBreakdown).toHaveBeenCalledTimes(3);
    expect(extractor.extractTransportComparison).toHaveBeenCalledTimes(1);
    expect(extractor.extractSdkVersions).toHaveBeenCalledTimes(1);
    expect(extractor.extractFailures).toHaveBeenCalledTimes(1);
    expect(extractor.extractLatency).toHaveBeenCalledTimes(1);
    expect(extractor.extractTimeseries).toHaveBeenCalledTimes(5);

    expect(transformer.transformDeviceBreakdown).toHaveBeenCalledTimes(3);
    expect(transformer.transformTimeseries).toHaveBeenCalledTimes(5);
    expect(loader.loadDeviceBreakdown).toHaveBeenCalledTimes(3);
    expect(loader.loadTimeseries).toHaveBeenCalledTimes(5);
  });

  it('tạo TrackingAggQuery và TransformContext đúng theo tenant, match, timeline và cửa sổ 5 phút', async () => {
    // Nghiệp vụ: dữ liệu của trận live chỉ được aggregate trong cửa sổ [now - 5 phút, now].
    await processor.process(liveMatchJob);

    expect(extractor.extractPlatformMetrics).toHaveBeenCalledWith(expectedQuery);
    expect(extractor.extractDeviceBreakdown).toHaveBeenNthCalledWith(
      1,
      expectedQuery,
      'browser',
    );
    expect(extractor.extractTransportComparison).toHaveBeenCalledWith(expectedQuery);
    expect(extractor.extractLatency).toHaveBeenCalledWith(expectedQuery);

    expect(allTransformContexts()).toHaveLength(13);
    for (const ctx of allTransformContexts()) {
      expect(ctx).toEqual(expectedContext);
    }
  });

  it('load latency với metricType overall để lưu bản ghi percentile tổng thể của trận live', async () => {
    // Nghiệp vụ: bước latency ghi 1 record tổng thể trước khi loader upsert vào MongoDB.
    await processor.process(liveMatchJob);

    expect(transformer.transformLatency).toHaveBeenCalledWith(
      aggResult('latency').aggregations,
      expectedContext,
    );
    expect(loader.loadLatency).toHaveBeenCalledTimes(1);
    expect(loader.loadLatency).toHaveBeenCalledWith([
      expect.objectContaining({ metricType: 'overall' }),
    ]);
  });

  it('lặp timeseries qua 5 metric nghiệp vụ với interval 5m', async () => {
    // Nghiệp vụ: timeseries phải có đủ sent, received, rendered, failed và avgRenderMs cho biểu đồ 5 phút.
    await processor.process(liveMatchJob);

    const metrics = ['sent', 'received', 'rendered', 'failed', 'avgRenderMs'];

    metrics.forEach((metric, index) => {
      expect(extractor.extractTimeseries).toHaveBeenNthCalledWith(
        index + 1,
        expectedQuery,
        metric,
        '5m',
      );
      expect(transformer.transformTimeseries).toHaveBeenNthCalledWith(
        index + 1,
        aggResult('timeseries').aggregations,
        expectedContext,
        metric,
        '5m',
      );
      expect(loader.loadTimeseries).toHaveBeenNthCalledWith(index + 1, [
        { metric, interval: '5m', value: 100 },
      ]);
    });
  });

  it('ghi log đúng format cho từng bước ETL của timeline', async () => {
    // Nghiệp vụ: operator cần log đầy đủ từng bước để theo dõi ETL của timeline trong trận live.
    await processor.process(liveMatchJob);

    expect(logSpy.mock.calls.map((call) => call[0])).toEqual([
      'Processing job job-uc-01',
      'Timeline tl-001 - Platform metrics: 1 items',
      'Timeline tl-001 - Device breakdown (browser): 1 items',
      'Timeline tl-001 - Device breakdown (os): 1 items',
      'Timeline tl-001 - Device breakdown (deviceClass): 1 items',
      'Timeline tl-001 - Transport comparison: 1 items',
      'Timeline tl-001 - SDK versions: 1 items',
      'Timeline tl-001 - Failures: 2 items',
      'Timeline tl-001 - Latency: 1 item',
      'Timeline tl-001 - Timeseries (sent): 1 items',
      'Timeline tl-001 - Timeseries (received): 1 items',
      'Timeline tl-001 - Timeseries (rendered): 1 items',
      'Timeline tl-001 - Timeseries (failed): 1 items',
      'Timeline tl-001 - Timeseries (avgRenderMs): 1 items',
      'Job job-uc-01 completed',
    ]);
  });
});
