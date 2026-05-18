import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ElasticsearchService } from '@nestjs/elasticsearch';
import { getModelToken } from '@nestjs/mongoose';
import { TrackingAggQuery } from '@modules/overlay-metrics-etl/extractor/dto/tracking-agg-query.dto';
import { TrackingEsService } from '@modules/overlay-metrics-etl/extractor/elasticsearch/tracking-es.service';
import { DeviceBreakdownAggs } from '@modules/overlay-metrics-etl/extractor/elasticsearch/types/tracking-es-aggs.types';
import { TransformerService } from '@modules/overlay-metrics-etl/transformer/transformer.service';
import { TransformContext } from '@modules/overlay-metrics-etl/interfaces/transform-context.interface';
import { DeviceBreakdownDto } from '@domain/dto/device-breakdown.dto';
import { LoaderService } from '@modules/overlay-metrics-etl/loader/loader.service';
import { OverlayMetricsRepository } from '@infrastructure/persistence/overlay-metrics.repository';
import { TenantModelFactory } from '@infrastructure/persistence/tenant-model.factory';
import { MetricType } from '@domain/enums/metric-type.enum';

type DeviceDimension = 'browser' | 'os' | 'deviceClass';

type DeviceBucketInput = {
  key: string;
  received: number;
  rendered: number;
  failed: number;
  avgRenderMs?: number;
};

type ModelMock = {
  bulkWrite: jest.Mock;
};

describe('UC-03 Device breakdown use case', () => {
  let moduleRef: TestingModule;
  let trackingEs: TrackingEsService;
  let transformer: TransformerService;
  let loader: LoaderService;
  let esSearchMock: jest.Mock;
  let deviceModel: ModelMock;

  const dimensions: DeviceDimension[] = ['browser', 'os', 'deviceClass'];

  const ctx: TransformContext = {
    timelineId: 'timeline-match-001',
    matchId: 'match-001',
    tenantId: 'tenant-001',
    intervalFrom: new Date('2026-05-13T10:00:00.000Z'),
    intervalTo: new Date('2026-05-13T10:05:00.000Z'),
  };

  const query: TrackingAggQuery = {
    timelineIds: [ctx.timelineId],
    tenantId: ctx.tenantId,
    mediaContentId: ctx.matchId,
    from: ctx.intervalFrom,
    to: ctx.intervalTo,
  };

  const createModelMock = (): ModelMock => ({
    bulkWrite: jest.fn().mockResolvedValue({ acknowledged: true }),
  });

  const makeAgg = (buckets: DeviceBucketInput[]): DeviceBreakdownAggs => ({
    by_dimension: {
      buckets: buckets.map((bucket) => ({
        key: bucket.key,
        doc_count: bucket.received + bucket.rendered + bucket.failed,
        by_stage: {
          buckets: {
            received: { doc_count: bucket.received },
            rendered: {
              doc_count: bucket.rendered,
              avg_render_ms: { value: bucket.avgRenderMs ?? 0 },
            },
            failed: { doc_count: bucket.failed },
          },
        },
      })),
    },
  });

  const esResult = (aggregations: DeviceBreakdownAggs) => ({
    took: 1,
    aggregations,
  });

  const runDeviceBreakdownLoop = async (): Promise<DeviceBreakdownDto[][]> => {
    const loadedByDimension: DeviceBreakdownDto[][] = [];

    for (const dimension of dimensions) {
      const deviceAgg = await trackingEs.queryDeviceBreakdown(query, dimension);
      const items = transformer.transformDeviceBreakdown(
        deviceAgg.aggregations,
        ctx,
        dimension,
      );

      await loader.load(ctx.tenantId, MetricType.DEVICE, items);
      loadedByDimension.push(items);
    }

    return loadedByDimension;
  };

  beforeEach(async () => {
    esSearchMock = jest.fn();
    deviceModel = createModelMock();

    const configGetMock = jest.fn((key: string, defaultValue?: unknown) => {
      const values: Record<string, unknown> = {
        'elasticsearch.trackingIndex': 'tracking-events-*',
        'elasticsearch.trackingTimeoutMs': 5000,
        'app.elasticApmEnvironment': 'production',
      };

      return values[key] ?? defaultValue;
    });

    const tenantModelFactoryMock = {
      getModelByType: jest
        .fn()
        .mockImplementation((_tenantId: string, type: MetricType) => {
          if (type === MetricType.DEVICE) return deviceModel;
          return createModelMock();
        }),
    };

    moduleRef = await Test.createTestingModule({
      providers: [
        TrackingEsService,
        TransformerService,
        LoaderService,
        OverlayMetricsRepository,
        { provide: ElasticsearchService, useValue: { search: esSearchMock } },
        { provide: ConfigService, useValue: { get: configGetMock } },
        { provide: TenantModelFactory, useValue: tenantModelFactoryMock },
      ],
    }).compile();

    trackingEs = moduleRef.get(TrackingEsService);
    transformer = moduleRef.get(TransformerService);
    loader = moduleRef.get(LoaderService);
  });

  afterEach(async () => {
    await moduleRef.close();
    jest.restoreAllMocks();
  });

  it('queries browser, os, deviceClass sequentially, transforms each bucket set, and loads each dimension', async () => {
    esSearchMock
      .mockResolvedValueOnce(
        esResult(
          makeAgg([
            {
              key: 'Chrome',
              received: 120,
              rendered: 90,
              failed: 6,
              avgRenderMs: 81.234,
            },
            {
              key: 'Firefox',
              received: 80,
              rendered: 64,
              failed: 4,
              avgRenderMs: 95,
            },
            {
              key: 'Safari',
              received: 50,
              rendered: 45,
              failed: 1,
              avgRenderMs: 100,
            },
          ]),
        ),
      )
      .mockResolvedValueOnce(
        esResult(
          makeAgg([
            {
              key: 'Windows',
              received: 100,
              rendered: 75,
              failed: 5,
              avgRenderMs: 88,
            },
            {
              key: 'macOS',
              received: 90,
              rendered: 72,
              failed: 3,
              avgRenderMs: 91,
            },
            {
              key: 'Linux',
              received: 60,
              rendered: 54,
              failed: 2,
              avgRenderMs: 79,
            },
          ]),
        ),
      )
      .mockResolvedValueOnce(
        esResult(
          makeAgg([
            {
              key: 'Desktop',
              received: 150,
              rendered: 120,
              failed: 6,
              avgRenderMs: 86,
            },
            {
              key: 'Mobile',
              received: 70,
              rendered: 56,
              failed: 4,
              avgRenderMs: 110,
            },
            {
              key: 'Tablet',
              received: 30,
              rendered: 27,
              failed: 1,
              avgRenderMs: 99,
            },
          ]),
        ),
      );

    const loadSpy = jest.spyOn(loader, 'load');

    const loadedItems = await runDeviceBreakdownLoop();

    const expectedBrowserItems: DeviceBreakdownDto[] = [
      {
        timelineId: ctx.timelineId,
        matchId: ctx.matchId,
        tenantId: ctx.tenantId,
        dimension: 'browser',
        bucketKey: 'Chrome',
        received: 120,
        rendered: 90,
        failed: 6,
        renderRate: 75,
        avgRenderMs: 81.23,
        intervalFrom: ctx.intervalFrom,
        intervalTo: ctx.intervalTo,
      },
      {
        timelineId: ctx.timelineId,
        matchId: ctx.matchId,
        tenantId: ctx.tenantId,
        dimension: 'browser',
        bucketKey: 'Firefox',
        received: 80,
        rendered: 64,
        failed: 4,
        renderRate: 80,
        avgRenderMs: 95,
        intervalFrom: ctx.intervalFrom,
        intervalTo: ctx.intervalTo,
      },
      {
        timelineId: ctx.timelineId,
        matchId: ctx.matchId,
        tenantId: ctx.tenantId,
        dimension: 'browser',
        bucketKey: 'Safari',
        received: 50,
        rendered: 45,
        failed: 1,
        renderRate: 90,
        avgRenderMs: 100,
        intervalFrom: ctx.intervalFrom,
        intervalTo: ctx.intervalTo,
      },
    ];

    const expectedOsItems: DeviceBreakdownDto[] = [
      {
        timelineId: ctx.timelineId,
        matchId: ctx.matchId,
        tenantId: ctx.tenantId,
        dimension: 'os',
        bucketKey: 'Windows',
        received: 100,
        rendered: 75,
        failed: 5,
        renderRate: 75,
        avgRenderMs: 88,
        intervalFrom: ctx.intervalFrom,
        intervalTo: ctx.intervalTo,
      },
      {
        timelineId: ctx.timelineId,
        matchId: ctx.matchId,
        tenantId: ctx.tenantId,
        dimension: 'os',
        bucketKey: 'macOS',
        received: 90,
        rendered: 72,
        failed: 3,
        renderRate: 80,
        avgRenderMs: 91,
        intervalFrom: ctx.intervalFrom,
        intervalTo: ctx.intervalTo,
      },
      {
        timelineId: ctx.timelineId,
        matchId: ctx.matchId,
        tenantId: ctx.tenantId,
        dimension: 'os',
        bucketKey: 'Linux',
        received: 60,
        rendered: 54,
        failed: 2,
        renderRate: 90,
        avgRenderMs: 79,
        intervalFrom: ctx.intervalFrom,
        intervalTo: ctx.intervalTo,
      },
    ];

    const expectedDeviceClassItems: DeviceBreakdownDto[] = [
      {
        timelineId: ctx.timelineId,
        matchId: ctx.matchId,
        tenantId: ctx.tenantId,
        dimension: 'deviceClass',
        bucketKey: 'Desktop',
        received: 150,
        rendered: 120,
        failed: 6,
        renderRate: 80,
        avgRenderMs: 86,
        intervalFrom: ctx.intervalFrom,
        intervalTo: ctx.intervalTo,
      },
      {
        timelineId: ctx.timelineId,
        matchId: ctx.matchId,
        tenantId: ctx.tenantId,
        dimension: 'deviceClass',
        bucketKey: 'Mobile',
        received: 70,
        rendered: 56,
        failed: 4,
        renderRate: 80,
        avgRenderMs: 110,
        intervalFrom: ctx.intervalFrom,
        intervalTo: ctx.intervalTo,
      },
      {
        timelineId: ctx.timelineId,
        matchId: ctx.matchId,
        tenantId: ctx.tenantId,
        dimension: 'deviceClass',
        bucketKey: 'Tablet',
        received: 30,
        rendered: 27,
        failed: 1,
        renderRate: 90,
        avgRenderMs: 99,
        intervalFrom: ctx.intervalFrom,
        intervalTo: ctx.intervalTo,
      },
    ];

    expect(esSearchMock).toHaveBeenCalledTimes(3);
    expect(loadSpy).toHaveBeenCalledTimes(3);
    expect(loadedItems).toEqual([
      expectedBrowserItems,
      expectedOsItems,
      expectedDeviceClassItems,
    ]);
    expect(loadSpy).toHaveBeenNthCalledWith(
      1,
      ctx.tenantId,
      MetricType.DEVICE,
      expectedBrowserItems,
    );
    expect(loadSpy).toHaveBeenNthCalledWith(
      2,
      ctx.tenantId,
      MetricType.DEVICE,
      expectedOsItems,
    );
    expect(loadSpy).toHaveBeenNthCalledWith(
      3,
      ctx.tenantId,
      MetricType.DEVICE,
      expectedDeviceClassItems,
    );

    expect(
      esSearchMock.mock.calls.map(
        ([request]) => request.aggs.by_dimension.terms.field as string,
      ),
    ).toEqual(['labels.browser', 'labels.client_os', 'labels.device_class']);

    expect(
      esSearchMock.mock.calls.map(
        ([request]) => request.aggs.by_dimension.terms.missing as string,
      ),
    ).toEqual(['unknown', 'unknown', 'unknown']);

    expect(deviceModel.bulkWrite).toHaveBeenCalledTimes(3);
    expect(esSearchMock.mock.invocationCallOrder[0]).toBeLessThan(
      loadSpy.mock.invocationCallOrder[0],
    );
    expect(loadSpy.mock.invocationCallOrder[0]).toBeLessThan(
      esSearchMock.mock.invocationCallOrder[1],
    );
    expect(esSearchMock.mock.invocationCallOrder[1]).toBeLessThan(
      loadSpy.mock.invocationCallOrder[1],
    );
    expect(loadSpy.mock.invocationCallOrder[1]).toBeLessThan(
      esSearchMock.mock.invocationCallOrder[2],
    );
    expect(esSearchMock.mock.invocationCallOrder[2]).toBeLessThan(
      loadSpy.mock.invocationCallOrder[2],
    );
  });

  it('falls back to labels.browser when an invalid dimension is queried', async () => {
    esSearchMock.mockResolvedValueOnce(esResult(makeAgg([])));

    await trackingEs.queryDeviceBreakdown(query, 'unsupported-dimension');

    expect(esSearchMock).toHaveBeenCalledTimes(1);
    expect(esSearchMock.mock.calls[0][0].aggs.by_dimension.terms.field).toBe(
      'labels.browser',
    );
  });

  it('loads an empty array for an empty dimension and LoaderService returns before bulkWrite', async () => {
    esSearchMock
      .mockResolvedValueOnce(
        esResult(
          makeAgg([{ key: 'Chrome', received: 10, rendered: 8, failed: 1 }]),
        ),
      )
      .mockResolvedValueOnce(esResult(makeAgg([])))
      .mockResolvedValueOnce(
        esResult(
          makeAgg([{ key: 'Desktop', received: 10, rendered: 9, failed: 0 }]),
        ),
      );

    const loadSpy = jest.spyOn(loader, 'load');

    const loadedItems = await runDeviceBreakdownLoop();

    expect(loadedItems[1]).toEqual([]);
    expect(loadSpy).toHaveBeenNthCalledWith(
      2,
      ctx.tenantId,
      MetricType.DEVICE,
      [],
    );
    expect(deviceModel.bulkWrite).toHaveBeenCalledTimes(2);
  });
});
