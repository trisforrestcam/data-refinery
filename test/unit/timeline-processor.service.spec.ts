import { Logger } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { TimelineProcessorService } from '@modules/overlay-metrics-etl/kafka/timeline-processor.service';
import { ExtractorService } from '@modules/overlay-metrics-etl/extractor/extractor.service';
import { TransformerService } from '@modules/overlay-metrics-etl/transformer/transformer.service';
import { LoaderService } from '@modules/overlay-metrics-etl/loader/loader.service';
import { JobPayload } from '@modules/overlay-metrics-etl/kafka/kafka-producer.service';

describe('TimelineProcessorService', () => {
  let service: TimelineProcessorService;
  let extractor: {
    extractPlatformMetrics: jest.Mock;
    extractDeviceBreakdown: jest.Mock;
    extractTransportComparison: jest.Mock;
    extractSdkVersions: jest.Mock;
    extractFailures: jest.Mock;
    extractLatency: jest.Mock;
    extractTimeseries: jest.Mock;
  };
  let transformer: {
    transformPlatformMetrics: jest.Mock;
    transformDeviceBreakdown: jest.Mock;
    transformTransportComparison: jest.Mock;
    transformSdkVersions: jest.Mock;
    transformFailures: jest.Mock;
    transformLatency: jest.Mock;
    transformTimeseries: jest.Mock;
  };
  let loader: {
    loadPlatformMetrics: jest.Mock;
    loadDeviceBreakdown: jest.Mock;
    loadTransportComparison: jest.Mock;
    loadSdkVersions: jest.Mock;
    loadFailures: jest.Mock;
    loadLatency: jest.Mock;
    loadTimeseries: jest.Mock;
  };

  const createPayload = (overrides?: Partial<JobPayload>): JobPayload => ({
    tenantId: 'tenant-001',
    matchId: 'match-123',
    timelineId: 'tl-001',
    timeRangeMinutes: 60,
    origin: 'scheduled',
    ...overrides,
  });

  const createAggResult = (name: string) => ({
    aggregations: { name },
    took: 3,
  });

  beforeEach(async () => {
    extractor = {
      extractPlatformMetrics: jest.fn().mockResolvedValue(createAggResult('platform')),
      extractDeviceBreakdown: jest.fn().mockResolvedValue(createAggResult('device')),
      extractTransportComparison: jest.fn().mockResolvedValue(createAggResult('transport')),
      extractSdkVersions: jest.fn().mockResolvedValue(createAggResult('sdk')),
      extractFailures: jest.fn().mockResolvedValue(createAggResult('failure')),
      extractLatency: jest.fn().mockResolvedValue(createAggResult('latency')),
      extractTimeseries: jest.fn().mockResolvedValue(createAggResult('timeseries')),
    };

    transformer = {
      transformPlatformMetrics: jest.fn().mockReturnValue([{ platform: 'web' }]),
      transformDeviceBreakdown: jest.fn().mockImplementation((_agg, _ctx, dimension: string) => [{ dimension }]),
      transformTransportComparison: jest.fn().mockReturnValue([{ transportMode: 'ws' }]),
      transformSdkVersions: jest.fn().mockReturnValue([{ sdkVersion: '1.0.0' }]),
      transformFailures: jest.fn().mockReturnValue([{ failureReason: 'timeout' }]),
      transformLatency: jest.fn().mockReturnValue({ metricType: 'overall' }),
      transformTimeseries: jest.fn().mockImplementation((_agg, _ctx, metric: string, interval: string) => [
        { metric, interval, value: 1 },
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

    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        TimelineProcessorService,
        { provide: ExtractorService, useValue: extractor },
        { provide: TransformerService, useValue: transformer },
        { provide: LoaderService, useValue: loader },
      ],
    }).compile();

    service = moduleRef.get(TimelineProcessorService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('processTimeline gọi extract→transform→load đúng thứ tự cho 7 metric types (13 extracts)', async () => {
    await service.processTimeline(createPayload());

    // 13 extracts total
    expect(extractor.extractPlatformMetrics).toHaveBeenCalledTimes(1);
    expect(extractor.extractDeviceBreakdown).toHaveBeenCalledTimes(3);
    expect(extractor.extractTransportComparison).toHaveBeenCalledTimes(1);
    expect(extractor.extractSdkVersions).toHaveBeenCalledTimes(1);
    expect(extractor.extractFailures).toHaveBeenCalledTimes(1);
    expect(extractor.extractLatency).toHaveBeenCalledTimes(1);
    expect(extractor.extractTimeseries).toHaveBeenCalledTimes(5);

    // Device breakdown được gọi với đúng dimension
    expect(extractor.extractDeviceBreakdown).toHaveBeenNthCalledWith(1, expect.anything(), 'browser');
    expect(extractor.extractDeviceBreakdown).toHaveBeenNthCalledWith(2, expect.anything(), 'os');
    expect(extractor.extractDeviceBreakdown).toHaveBeenNthCalledWith(3, expect.anything(), 'deviceClass');

    // Timeseries được gọi với đúng metric
    expect(extractor.extractTimeseries).toHaveBeenNthCalledWith(1, expect.anything(), 'sent', '5m');
    expect(extractor.extractTimeseries).toHaveBeenNthCalledWith(2, expect.anything(), 'received', '5m');
    expect(extractor.extractTimeseries).toHaveBeenNthCalledWith(3, expect.anything(), 'rendered', '5m');
    expect(extractor.extractTimeseries).toHaveBeenNthCalledWith(4, expect.anything(), 'failed', '5m');
    expect(extractor.extractTimeseries).toHaveBeenNthCalledWith(5, expect.anything(), 'avgRenderMs', '5m');

    // Transformers được gọi tương ứng
    expect(transformer.transformPlatformMetrics).toHaveBeenCalledTimes(1);
    expect(transformer.transformDeviceBreakdown).toHaveBeenCalledTimes(3);
    expect(transformer.transformTransportComparison).toHaveBeenCalledTimes(1);
    expect(transformer.transformSdkVersions).toHaveBeenCalledTimes(1);
    expect(transformer.transformFailures).toHaveBeenCalledTimes(1);
    expect(transformer.transformLatency).toHaveBeenCalledTimes(1);
    expect(transformer.transformTimeseries).toHaveBeenCalledTimes(5);

    // Loaders được gọi tương ứng
    expect(loader.loadPlatformMetrics).toHaveBeenCalledTimes(1);
    expect(loader.loadDeviceBreakdown).toHaveBeenCalledTimes(3);
    expect(loader.loadTransportComparison).toHaveBeenCalledTimes(1);
    expect(loader.loadSdkVersions).toHaveBeenCalledTimes(1);
    expect(loader.loadFailures).toHaveBeenCalledTimes(1);
    expect(loader.loadLatency).toHaveBeenCalledTimes(1);
    expect(loader.loadTimeseries).toHaveBeenCalledTimes(5);
  });

  it('extractSdkVersions throw → các loader phía sau KHÔNG được gọi', async () => {
    extractor.extractSdkVersions.mockRejectedValueOnce(new Error('ES query failed'));

    await expect(service.processTimeline(createPayload())).rejects.toThrow('ES query failed');

    // Các extract/transform/load trước sdk VẪN được gọi
    expect(extractor.extractPlatformMetrics).toHaveBeenCalled();
    expect(extractor.extractDeviceBreakdown).toHaveBeenCalledTimes(3);
    expect(extractor.extractTransportComparison).toHaveBeenCalled();
    expect(loader.loadPlatformMetrics).toHaveBeenCalled();
    expect(loader.loadDeviceBreakdown).toHaveBeenCalledTimes(3);
    expect(loader.loadTransportComparison).toHaveBeenCalled();

    // Sdk và các bước sau KHÔNG được gọi
    expect(extractor.extractFailures).not.toHaveBeenCalled();
    expect(extractor.extractLatency).not.toHaveBeenCalled();
    expect(extractor.extractTimeseries).not.toHaveBeenCalled();
    expect(loader.loadSdkVersions).not.toHaveBeenCalled();
    expect(loader.loadFailures).not.toHaveBeenCalled();
    expect(loader.loadLatency).not.toHaveBeenCalled();
    expect(loader.loadTimeseries).not.toHaveBeenCalled();
  });
});
