import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { ExtractorService } from '../../src/modules/overlay-metrics-etl/extractor/extractor.service';
import { TrackingEsService } from '../../src/modules/overlay-metrics-etl/extractor/elasticsearch/tracking-es.service';
import { TransformerService } from '../../src/modules/overlay-metrics-etl/transformer/transformer.service';
import { LoaderService } from '../../src/modules/overlay-metrics-etl/loader/loader.service';
import { TimelineProcessorService } from '@modules/overlay-metrics-etl/kafka/timeline-processor.service';
import { OverlayMetricsRepository } from '../../src/infrastructure/persistence/overlay-metrics.repository';
import { TenantModelFactory } from '../../src/infrastructure/persistence/tenant-model.factory';
import { MetricType } from '../../src/domain/enums/metric-type.enum';
import {
  OverlayMetricsDevice,
  OverlayMetricsFailure,
  OverlayMetricsLatency,
  OverlayMetricsPlatform,
  OverlayMetricsSdk,
  OverlayMetricsTimeseries,
  OverlayMetricsTransport,
} from '../../src/domain/schemas';
import { TransformContext } from '../../src/modules/overlay-metrics-etl/interfaces/transform-context.interface';
import { LatencyPercentileDto } from '../../src/domain/dto/latency-percentile.dto';

type MockModel = { bulkWrite: jest.Mock };
type TrackingEsMock = Record<
  | 'queryPlatformMetrics'
  | 'queryDeviceBreakdown'
  | 'queryTransportComparison'
  | 'querySdkVersions'
  | 'queryFailures'
  | 'queryLatency'
  | 'queryTimeseries',
  jest.Mock
>;
type LoaderMock = Record<
  | 'loadPlatformMetrics'
  | 'loadDeviceBreakdown'
  | 'loadTransportComparison'
  | 'loadSdkVersions'
  | 'loadFailures'
  | 'loadLatency'
  | 'loadTimeseries',
  jest.Mock
>;

describe('UC-09 - Empty window không có events trong 5 phút', () => {
  const intervalFrom = new Date('2026-05-13T10:00:00.000Z');
  const intervalTo = new Date('2026-05-13T10:05:00.000Z');
  const ctx: TransformContext = {
    timelineId: 'timeline-empty-001',
    matchId: 'match-empty-001',
    tenantId: 'tenant-001',
    intervalFrom,
    intervalTo,
  };
  const zeroPercentileSet = {
    p50: 0,
    p75: 0,
    p95: 0,
    p99: 0,
    avg: 0,
    max: 0,
  };
  const zeroRenderDurationSet = { p50: 0, p95: 0, p99: 0, avg: 0 };

  it('transform trả về empty arrays và LatencyPercentileDto all zeros khi aggregations rỗng', async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [TransformerService],
    }).compile();
    const transformer = moduleRef.get(TransformerService);

    expect(transformer.transformPlatformMetrics({}, ctx)).toEqual([]);
    expect(transformer.transformDeviceBreakdown({}, ctx, 'browser')).toEqual(
      [],
    );
    expect(transformer.transformDeviceBreakdown({}, ctx, 'os')).toEqual([]);
    expect(
      transformer.transformDeviceBreakdown({}, ctx, 'deviceClass'),
    ).toEqual([]);
    expect(transformer.transformTransportComparison({}, ctx)).toEqual([]);
    expect(transformer.transformSdkVersions({}, ctx)).toEqual([]);
    expect(transformer.transformFailures({}, ctx)).toEqual([]);
    expect(transformer.transformTimeseries({}, ctx, 'sent', '5m')).toEqual([]);

    const latency: LatencyPercentileDto = transformer.transformLatency({}, ctx);
    expect(latency).toEqual({
      timelineId: ctx.timelineId,
      matchId: ctx.matchId,
      tenantId: ctx.tenantId,
      receive: zeroPercentileSet,
      render: zeroPercentileSet,
      ack: zeroPercentileSet,
      renderDuration: zeroRenderDurationSet,
      intervalFrom: ctx.intervalFrom,
      intervalTo: ctx.intervalTo,
    });

    await moduleRef.close();
  });

  it('loader early return cho tất cả collections khi nhận empty arrays', async () => {
    const createModel = (): MockModel => ({
      bulkWrite: jest.fn().mockResolvedValue(undefined),
    });
    const platformModel = createModel();
    const deviceModel = createModel();
    const transportModel = createModel();
    const sdkModel = createModel();
    const failureModel = createModel();
    const timeseriesModel = createModel();
    const latencyModel = createModel();

    const tenantModelFactoryMock = {
      getModelByType: jest.fn().mockImplementation((_tenantId: string, type: MetricType) => {
        switch (type) {
          case MetricType.PLATFORM: return platformModel;
          case MetricType.DEVICE: return deviceModel;
          case MetricType.TRANSPORT: return transportModel;
          case MetricType.SDK: return sdkModel;
          case MetricType.FAILURE: return failureModel;
          case MetricType.TIMESERIES: return timeseriesModel;
          case MetricType.LATENCY: return latencyModel;
        }
      }),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        LoaderService,
        OverlayMetricsRepository,
        { provide: TenantModelFactory, useValue: tenantModelFactoryMock },
      ],
    }).compile();
    const loader = moduleRef.get(LoaderService);

    await loader.loadPlatformMetrics(ctx.tenantId, []);
    await loader.loadDeviceBreakdown(ctx.tenantId, []);
    await loader.loadTransportComparison(ctx.tenantId, []);
    await loader.loadSdkVersions(ctx.tenantId, []);
    await loader.loadFailures(ctx.tenantId, []);
    await loader.loadTimeseries(ctx.tenantId, []);
    await loader.loadLatency(ctx.tenantId, []);

    expect(platformModel.bulkWrite).not.toHaveBeenCalled();
    expect(deviceModel.bulkWrite).not.toHaveBeenCalled();
    expect(transportModel.bulkWrite).not.toHaveBeenCalled();
    expect(sdkModel.bulkWrite).not.toHaveBeenCalled();
    expect(failureModel.bulkWrite).not.toHaveBeenCalled();
    expect(timeseriesModel.bulkWrite).not.toHaveBeenCalled();
    expect(latencyModel.bulkWrite).not.toHaveBeenCalled();

    await moduleRef.close();
  });

  it('processor hoàn thành job khi toàn bộ ES queries trả về empty aggregations', async () => {
    const emptyResult = { aggregations: {}, took: 0 };
    const trackingEsMock: TrackingEsMock = {
      queryPlatformMetrics: jest.fn().mockResolvedValue(emptyResult),
      queryDeviceBreakdown: jest.fn().mockResolvedValue(emptyResult),
      queryTransportComparison: jest.fn().mockResolvedValue(emptyResult),
      querySdkVersions: jest.fn().mockResolvedValue(emptyResult),
      queryFailures: jest.fn().mockResolvedValue(emptyResult),
      queryLatency: jest.fn().mockResolvedValue(emptyResult),
      queryTimeseries: jest.fn().mockResolvedValue(emptyResult),
    };
    const loaderMock: LoaderMock = {
      loadPlatformMetrics: jest.fn().mockResolvedValue(undefined),
      loadDeviceBreakdown: jest.fn().mockResolvedValue(undefined),
      loadTransportComparison: jest.fn().mockResolvedValue(undefined),
      loadSdkVersions: jest.fn().mockResolvedValue(undefined),
      loadFailures: jest.fn().mockResolvedValue(undefined),
      loadLatency: jest.fn().mockResolvedValue(undefined),
      loadTimeseries: jest.fn().mockResolvedValue(undefined),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        TimelineProcessorService,
        ExtractorService,
        TransformerService,
        { provide: TrackingEsService, useValue: trackingEsMock },
        { provide: LoaderService, useValue: loaderMock },
      ],
    }).compile();
    const timelineProcessor = moduleRef.get(TimelineProcessorService);

    const payload = {
      tenantId: ctx.tenantId,
      matchId: ctx.matchId,
      timelineId: ctx.timelineId,
      timeRangeMinutes: 5,
      intervalFrom: intervalFrom.toISOString(),
      intervalTo: intervalTo.toISOString(),
    };

    await expect(timelineProcessor.processTimeline(payload)).resolves.toBeUndefined();

    const expectedQuery = {
      timelineIds: [ctx.timelineId],
      tenantId: ctx.tenantId,
      from: intervalFrom,
      to: intervalTo,
    };
    expect(trackingEsMock.queryPlatformMetrics).toHaveBeenCalledWith(
      expectedQuery,
    );
    expect(trackingEsMock.queryDeviceBreakdown).toHaveBeenCalledTimes(3);
    expect(trackingEsMock.queryDeviceBreakdown).toHaveBeenNthCalledWith(
      1,
      expectedQuery,
      'browser',
    );
    expect(trackingEsMock.queryDeviceBreakdown).toHaveBeenNthCalledWith(
      2,
      expectedQuery,
      'os',
    );
    expect(trackingEsMock.queryDeviceBreakdown).toHaveBeenNthCalledWith(
      3,
      expectedQuery,
      'deviceClass',
    );
    expect(trackingEsMock.queryTransportComparison).toHaveBeenCalledWith(
      expectedQuery,
    );
    expect(trackingEsMock.querySdkVersions).toHaveBeenCalledWith(expectedQuery);
    expect(trackingEsMock.queryFailures).toHaveBeenCalledWith(expectedQuery);
    expect(trackingEsMock.queryLatency).toHaveBeenCalledWith(expectedQuery);
    expect(trackingEsMock.queryTimeseries).toHaveBeenCalledTimes(5);

    expect(loaderMock.loadPlatformMetrics).toHaveBeenCalledWith(ctx.tenantId, []);
    expect(loaderMock.loadDeviceBreakdown).toHaveBeenCalledTimes(3);
    for (const call of loaderMock.loadDeviceBreakdown.mock.calls) {
      expect(call[0]).toEqual(ctx.tenantId);
      expect(call[1]).toEqual([]);
    }
    expect(loaderMock.loadTransportComparison).toHaveBeenCalledWith(ctx.tenantId, []);
    expect(loaderMock.loadSdkVersions).toHaveBeenCalledWith(ctx.tenantId, []);
    expect(loaderMock.loadFailures).toHaveBeenCalledWith(ctx.tenantId, []);
    expect(loaderMock.loadTimeseries).toHaveBeenCalledTimes(5);
    for (const call of loaderMock.loadTimeseries.mock.calls) {
      expect(call[0]).toEqual(ctx.tenantId);
      expect(call[1]).toEqual([]);
    }

    expect(loaderMock.loadLatency).toHaveBeenCalledTimes(1);
    const latencyItems = loaderMock.loadLatency.mock.calls[0][1] as LatencyPercentileDto[];
    expect(latencyItems).toHaveLength(1);
    expect(latencyItems[0]).toEqual({
      timelineId: ctx.timelineId,
      matchId: ctx.matchId,
      tenantId: ctx.tenantId,
      receive: zeroPercentileSet,
      render: zeroPercentileSet,
      ack: zeroPercentileSet,
      renderDuration: zeroRenderDurationSet,
      intervalFrom,
      intervalTo,
    });

    await moduleRef.close();
  });
});
