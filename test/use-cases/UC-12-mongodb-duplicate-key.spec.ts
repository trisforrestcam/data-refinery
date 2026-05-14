import { Test, TestingModule } from '@nestjs/testing';

import { MongoServerError } from 'mongodb';
import { ExtractorService } from '@modules/overlay-metrics-etl/extractor/extractor.service';
import { LoaderService } from '@modules/overlay-metrics-etl/loader/loader.service';
import { TimelineProcessorService } from '@modules/overlay-metrics-etl/kafka/timeline-processor.service';
import { OverlayMetricsRepository } from '@infrastructure/persistence/overlay-metrics.repository';
import { TenantModelFactory } from '@infrastructure/persistence/tenant-model.factory';
import { MetricType } from '@domain/enums/metric-type.enum';
import { TransformerService } from '@modules/overlay-metrics-etl/transformer/transformer.service';
import type {
  DeviceBreakdownDto,
  PlatformMetricDto,
} from '@domain/dto';

type MockModel = {
  bulkWrite: jest.Mock;
};

type ModelMap = {
  platformModel: MockModel;
  deviceModel: MockModel;
  transportModel: MockModel;
  sdkModel: MockModel;
  failureModel: MockModel;
  timeseriesModel: MockModel;
  latencyModel: MockModel;
};

const intervalFrom = new Date('2026-05-13T10:00:00.000Z');
const intervalTo = new Date('2026-05-13T10:05:00.000Z');

const platformItem: PlatformMetricDto = {
  timelineId: 'timeline-001',
  matchId: 'match-001',
  tenantId: 'tenant-001',
  platform: 'web',
  sent: 120,
  received: 118,
  rendered: 115,
  failed: 3,
  receiveRate: 98.33,
  renderRate: 97.46,
  failureRate: 2.54,
  netSuccessRate: 95.83,
  avgRenderMs: 52,
  intervalFrom,
  intervalTo,
};

const deviceItem: DeviceBreakdownDto = {
  timelineId: 'timeline-001',
  matchId: 'match-001',
  tenantId: 'tenant-001',
  dimension: 'browser',
  bucketKey: 'chrome',
  received: 80,
  rendered: 78,
  failed: 2,
  renderRate: 97.5,
  avgRenderMs: 44,
  intervalFrom,
  intervalTo,
};

const createModels = (): ModelMap => ({
  platformModel: { bulkWrite: jest.fn() },
  deviceModel: { bulkWrite: jest.fn() },
  transportModel: { bulkWrite: jest.fn() },
  sdkModel: { bulkWrite: jest.fn() },
  failureModel: { bulkWrite: jest.fn() },
  timeseriesModel: { bulkWrite: jest.fn() },
  latencyModel: { bulkWrite: jest.fn() },
});

const createTenantModelFactoryMock = (models: ModelMap) => ({
  getModelByType: jest.fn().mockImplementation((_tenantId: string, type: MetricType) => {
    switch (type) {
      case MetricType.PLATFORM: return models.platformModel;
      case MetricType.DEVICE: return models.deviceModel;
      case MetricType.TRANSPORT: return models.transportModel;
      case MetricType.SDK: return models.sdkModel;
      case MetricType.FAILURE: return models.failureModel;
      case MetricType.TIMESERIES: return models.timeseriesModel;
      case MetricType.LATENCY: return models.latencyModel;
    }
  }),
});

const createModelProviders = (models: ModelMap) => [
  {
    provide: TenantModelFactory,
    useValue: createTenantModelFactoryMock(models),
  },
];

const buildLoaderModule = async (models: ModelMap): Promise<TestingModule> =>
  Test.createTestingModule({
    providers: [LoaderService, OverlayMetricsRepository, ...createModelProviders(models)],
  }).compile();

describe('UC-12 - MongoDB duplicate key khi upsert', () => {
  let moduleRef: TestingModule | undefined;

  afterEach(async () => {
    await moduleRef?.close();
    jest.restoreAllMocks();
  });

  it('propagate MongoServerError code 11000 từ LoaderService lên processor khi bulkWrite duplicate key', async () => {
    const models = createModels();
    const duplicateKeyError = new MongoServerError({
      message:
        'E11000 duplicate key error collection: overlay_metrics_platform index: tenantId_1_matchId_1_platform_1_intervalFrom_1 dup key',
      errmsg:
        'E11000 duplicate key error collection: overlay_metrics_platform index: tenantId_1_matchId_1_platform_1_intervalFrom_1 dup key',
      code: 11000,
    });

    models.platformModel.bulkWrite.mockRejectedValue(duplicateKeyError);

    const extractor = {
      extractPlatformMetrics: jest.fn().mockResolvedValue({ aggregations: {} }),
      extractDeviceBreakdown: jest.fn(),
      extractTransportComparison: jest.fn(),
      extractSdkVersions: jest.fn(),
      extractFailures: jest.fn(),
      extractLatency: jest.fn(),
      extractTimeseries: jest.fn(),
    };

    const transformer = {
      transformPlatformMetrics: jest.fn().mockReturnValue([platformItem]),
      transformDeviceBreakdown: jest.fn(),
      transformTransportComparison: jest.fn(),
      transformSdkVersions: jest.fn(),
      transformFailures: jest.fn(),
      transformLatency: jest.fn(),
      transformTimeseries: jest.fn(),
    };

    moduleRef = await Test.createTestingModule({
      providers: [
        TimelineProcessorService,
        LoaderService,
        OverlayMetricsRepository,
        { provide: ExtractorService, useValue: extractor },
        { provide: TransformerService, useValue: transformer },
        ...createModelProviders(models),
      ],
    }).compile();

    const timelineProcessor = moduleRef.get(TimelineProcessorService);
    const payload = {
      tenantId: platformItem.tenantId,
      matchId: platformItem.matchId,
      timelineId: platformItem.timelineId,
      timeRangeMinutes: 5,
      intervalFrom: platformItem.intervalFrom.toISOString(),
      intervalTo: platformItem.intervalTo.toISOString(),
    };

    // TimelineProcessorService throws khi pipeline step fail để Kafka consumer xử lý retry/DLQ
    await expect(timelineProcessor.processTimeline(payload)).rejects.toThrow(MongoServerError);

    expect(models.platformModel.bulkWrite).toHaveBeenCalledTimes(1);
    expect(models.platformModel.bulkWrite).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          updateOne: expect.objectContaining({
            filter: {
              tenantId: platformItem.tenantId,
              matchId: platformItem.matchId,
              platform: platformItem.platform,
              intervalFrom: platformItem.intervalFrom,
            },
            upsert: true,
          }),
        }),
      ],
      { ordered: false },
    );
    expect(extractor.extractDeviceBreakdown).not.toHaveBeenCalled();
    expect(duplicateKeyError.code).toBe(11000);
  });

  it('upsert platform idempotent: lần 1 insert, lần 2 update cùng filter và không throw', async () => {
    const models = createModels();
    models.platformModel.bulkWrite
      .mockResolvedValueOnce({ upsertedCount: 1, matchedCount: 0, modifiedCount: 0 })
      .mockResolvedValueOnce({ upsertedCount: 0, matchedCount: 1, modifiedCount: 1 });

    moduleRef = await buildLoaderModule(models);
    const loader = moduleRef.get(LoaderService);

    const updatedPlatformItem: PlatformMetricDto = {
      ...platformItem,
      received: 119,
      rendered: 116,
      avgRenderMs: 49,
    };

    await expect(loader.loadPlatformMetrics(platformItem.tenantId, [platformItem])).resolves.toBeUndefined();
    await expect(
      loader.loadPlatformMetrics(platformItem.tenantId, [updatedPlatformItem]),
    ).resolves.toBeUndefined();

    expect(models.platformModel.bulkWrite).toHaveBeenCalledTimes(2);

    const firstOp = models.platformModel.bulkWrite.mock.calls[0][0][0];
    const secondOp = models.platformModel.bulkWrite.mock.calls[1][0][0];

    expect(firstOp.updateOne.filter).toEqual({
      tenantId: platformItem.tenantId,
      matchId: platformItem.matchId,
      platform: platformItem.platform,
      intervalFrom: platformItem.intervalFrom,
    });
    expect(firstOp.updateOne.update).toEqual(
      expect.objectContaining({
        $inc: { sent: platformItem.sent, received: platformItem.received, rendered: platformItem.rendered, failed: platformItem.failed },
        $set: expect.objectContaining({
          timelineId: platformItem.timelineId,
          matchId: platformItem.matchId,
          tenantId: platformItem.tenantId,
          platform: platformItem.platform,
          receiveRate: platformItem.receiveRate,
          renderRate: platformItem.renderRate,
          failureRate: platformItem.failureRate,
          netSuccessRate: platformItem.netSuccessRate,
          avgRenderMs: platformItem.avgRenderMs,
          intervalFrom: platformItem.intervalFrom,
          intervalTo: platformItem.intervalTo,
        }),
        $setOnInsert: expect.any(Object),
        $currentDate: { updatedAt: true },
      }),
    );
    expect(firstOp.updateOne.upsert).toBe(true);

    expect(secondOp.updateOne.filter).toEqual(firstOp.updateOne.filter);
    expect(secondOp.updateOne.update).toEqual(
      expect.objectContaining({
        $inc: { sent: updatedPlatformItem.sent, received: updatedPlatformItem.received, rendered: updatedPlatformItem.rendered, failed: updatedPlatformItem.failed },
        $set: expect.objectContaining({
          avgRenderMs: updatedPlatformItem.avgRenderMs,
        }),
        $setOnInsert: expect.any(Object),
        $currentDate: { updatedAt: true },
      }),
    );
    expect(secondOp.updateOne.upsert).toBe(true);

    expect(models.platformModel.bulkWrite.mock.calls[0][1]).toEqual({
      ordered: false,
    });
    expect(models.platformModel.bulkWrite.mock.calls[1][1]).toEqual({
      ordered: false,
    });
  });

  it('buildUpsertOps cho device dùng uniqueFields khác platform và vẫn update với upsert:true', async () => {
    const models = createModels();
    models.deviceModel.bulkWrite
      .mockResolvedValueOnce({ upsertedCount: 1, matchedCount: 0, modifiedCount: 0 })
      .mockResolvedValueOnce({ upsertedCount: 0, matchedCount: 1, modifiedCount: 1 });

    moduleRef = await buildLoaderModule(models);
    const loader = moduleRef.get(LoaderService);

    const updatedDeviceItem: DeviceBreakdownDto = {
      ...deviceItem,
      rendered: 79,
      avgRenderMs: 41,
    };

    await expect(loader.loadDeviceBreakdown(deviceItem.tenantId, [deviceItem])).resolves.toBeUndefined();
    await expect(
      loader.loadDeviceBreakdown(deviceItem.tenantId, [updatedDeviceItem]),
    ).resolves.toBeUndefined();

    expect(models.deviceModel.bulkWrite).toHaveBeenCalledTimes(2);

    const firstOp = models.deviceModel.bulkWrite.mock.calls[0][0][0];
    const secondOp = models.deviceModel.bulkWrite.mock.calls[1][0][0];

    expect(firstOp.updateOne.filter).toEqual({
      tenantId: deviceItem.tenantId,
      matchId: deviceItem.matchId,
      dimension: deviceItem.dimension,
      bucketKey: deviceItem.bucketKey,
      intervalFrom: deviceItem.intervalFrom,
    });
    expect(firstOp.updateOne.filter).not.toHaveProperty('platform');
    expect(firstOp.updateOne.update).toEqual(
      expect.objectContaining({
        $inc: { received: deviceItem.received, rendered: deviceItem.rendered, failed: deviceItem.failed },
        $set: expect.objectContaining({
          timelineId: deviceItem.timelineId,
          matchId: deviceItem.matchId,
          tenantId: deviceItem.tenantId,
          dimension: deviceItem.dimension,
          bucketKey: deviceItem.bucketKey,
          renderRate: deviceItem.renderRate,
          avgRenderMs: deviceItem.avgRenderMs,
          intervalFrom: deviceItem.intervalFrom,
          intervalTo: deviceItem.intervalTo,
        }),
        $setOnInsert: expect.any(Object),
        $currentDate: { updatedAt: true },
      }),
    );
    expect(firstOp.updateOne.upsert).toBe(true);

    expect(secondOp.updateOne.filter).toEqual(firstOp.updateOne.filter);
    expect(secondOp.updateOne.update).toEqual(
      expect.objectContaining({
        $inc: { received: updatedDeviceItem.received, rendered: updatedDeviceItem.rendered, failed: updatedDeviceItem.failed },
        $set: expect.objectContaining({
          avgRenderMs: updatedDeviceItem.avgRenderMs,
        }),
        $setOnInsert: expect.any(Object),
        $currentDate: { updatedAt: true },
      }),
    );
    expect(secondOp.updateOne.upsert).toBe(true);
  });
});
