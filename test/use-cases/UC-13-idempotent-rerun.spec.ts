import { Logger } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import type { Job } from 'bullmq';
import { ExtractorService } from '../../src/modules/overlay-metrics-etl/extractor/extractor.service';
import { LoaderService } from '../../src/modules/overlay-metrics-etl/loader/loader.service';
import { OverlayMetricsRepository } from '../../src/infrastructure/persistence/overlay-metrics.repository';
import { TenantModelFactory } from '../../src/infrastructure/persistence/tenant-model.factory';
import { MetricType } from '../../src/domain/enums/metric-type.enum';
import { OverlayMetricsProcessor } from '../../src/modules/overlay-metrics-etl/scheduler/processors/overlay-metrics.processor';
import { TransformerService } from '../../src/modules/overlay-metrics-etl/transformer/transformer.service';
import type { LatencyPercentileDto } from '../../src/domain/dto/latency-percentile.dto';
import type { PlatformMetricDto } from '../../src/domain/dto/platform-metric.dto';
import { OVERLAY_METRICS_JOB } from '../../src/common/constants/scheduler.constants';

type PlatformBulkWriteOp = {
  updateOne: {
    filter: {
      tenantId: string;
      matchId: string;
      platform: string;
      intervalFrom: Date;
    };
    update: {
      $inc: { sent: number; received: number; rendered: number; failed: number };
      $set: Partial<PlatformMetricDto>;
      $setOnInsert?: { createdAt: Date };
      $currentDate?: { updatedAt: true };
    };
    upsert: boolean;
  };
};

type StoredPlatformDoc = PlatformMetricDto & {
  createdAt?: Date;
  updatedAt?: Date;
};

type PlatformModelMock = {
  bulkWrite: jest.Mock;
  countDocuments: () => number;
  getDocuments: () => StoredPlatformDoc[];
};

describe('UC-13 - Idempotent rerun cho cùng interval', () => {
  const tenantId = 'tenant-rerun';
  const timelineId = 'timeline-rerun-001';
  const matchId = 'match-rerun-001';
  const intervalFrom = new Date('2026-05-13T10:00:00.000Z');
  const intervalTo = new Date('2026-05-13T10:05:00.000Z');
  const latencyDto: LatencyPercentileDto = {
    tenantId,
    timelineId,
    matchId,
    receive: { p50: 0, p75: 0, p95: 0, p99: 0, avg: 0, max: 0 },
    render: { p50: 0, p75: 0, p95: 0, p99: 0, avg: 0, max: 0 },
    ack: { p50: 0, p75: 0, p95: 0, p99: 0, avg: 0, max: 0 },
    renderDuration: { p50: 0, p95: 0, p99: 0, avg: 0 },
    intervalFrom,
    intervalTo,
  };

  const buildPlatformMetric = (
    platform: string,
    metrics: Pick<
      PlatformMetricDto,
      | 'sent'
      | 'received'
      | 'rendered'
      | 'failed'
      | 'receiveRate'
      | 'renderRate'
      | 'failureRate'
      | 'netSuccessRate'
      | 'avgRenderMs'
    >,
  ): PlatformMetricDto => ({
    tenantId,
    timelineId,
    matchId,
    platform,
    intervalFrom,
    intervalTo,
    ...metrics,
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

  const createPassiveModel = (): { bulkWrite: jest.Mock } => ({
    bulkWrite: jest.fn().mockResolvedValue(undefined),
  });

  const createPlatformModel = (): PlatformModelMock => {
    const docs = new Map<string, StoredPlatformDoc>();

    const buildKey = (filter: {
      tenantId: string;
      matchId: string;
      platform: string;
      intervalFrom: Date;
    }): string =>
      [
        filter.tenantId,
        filter.matchId,
        filter.platform,
        filter.intervalFrom.toISOString(),
      ].join('|');

    const bulkWrite = jest.fn().mockImplementation(
      async (
        ops: PlatformBulkWriteOp[],
        _options?: { ordered?: boolean },
      ): Promise<{ acknowledged: boolean }> => {
        for (const op of ops) {
          const { filter, update, upsert } = op.updateOne;
          const key = buildKey(filter);
          const existing = docs.get(key);

          const nextDoc: StoredPlatformDoc = {
            ...(existing ?? {}),
            ...update.$set,
            sent: (existing?.sent ?? 0) + update.$inc.sent,
            received: (existing?.received ?? 0) + update.$inc.received,
            rendered: (existing?.rendered ?? 0) + update.$inc.rendered,
            failed: (existing?.failed ?? 0) + update.$inc.failed,
            createdAt: existing?.createdAt ?? update.$setOnInsert?.createdAt,
            updatedAt: new Date(),
          } as StoredPlatformDoc;

          if (existing || upsert) {
            docs.set(key, nextDoc);
          }
        }

        return { acknowledged: true };
      },
    );

    return {
      bulkWrite,
      countDocuments: () => docs.size,
      getDocuments: () => Array.from(docs.values()).map((doc) => ({ ...doc })),
    };
  };

  const createScenario = async (platformRuns: PlatformMetricDto[][]): Promise<{
    moduleRef: TestingModule;
    processor: OverlayMetricsProcessor;
    extractor: { extractPlatformMetrics: jest.Mock };
    transformer: { transformPlatformMetrics: jest.Mock };
    platformModel: PlatformModelMock;
  }> => {
    const platformModel = createPlatformModel();
    const passiveModel = createPassiveModel();

    const extractPlatformMetrics = jest.fn();
    platformRuns.forEach((_items, runIndex) => {
      extractPlatformMetrics.mockResolvedValueOnce({ aggregations: { runIndex } });
    });

    const extractor = {
      extractPlatformMetrics,
      extractDeviceBreakdown: jest.fn().mockResolvedValue({ aggregations: {} }),
      extractTransportComparison: jest.fn().mockResolvedValue({ aggregations: {} }),
      extractSdkVersions: jest.fn().mockResolvedValue({ aggregations: {} }),
      extractFailures: jest.fn().mockResolvedValue({ aggregations: {} }),
      extractLatency: jest.fn().mockResolvedValue({ aggregations: {} }),
      extractTimeseries: jest.fn().mockResolvedValue({ aggregations: {} }),
    };

    const transformer = {
      transformPlatformMetrics: jest
        .fn()
        .mockImplementation((aggregations: { runIndex: number }) => {
          return platformRuns[aggregations.runIndex] ?? [];
        }),
      transformDeviceBreakdown: jest.fn().mockReturnValue([]),
      transformTransportComparison: jest.fn().mockReturnValue([]),
      transformSdkVersions: jest.fn().mockReturnValue([]),
      transformFailures: jest.fn().mockReturnValue([]),
      transformLatency: jest.fn().mockReturnValue(latencyDto),
      transformTimeseries: jest.fn().mockReturnValue([]),
    };

    const tenantModelFactoryMock = {
      getModelByType: jest.fn().mockImplementation((_tenantId: string, type: MetricType) => {
        switch (type) {
          case MetricType.PLATFORM: return platformModel;
          default: return passiveModel;
        }
      }),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        OverlayMetricsProcessor,
        LoaderService,
        OverlayMetricsRepository,
        { provide: ExtractorService, useValue: extractor },
        { provide: TransformerService, useValue: transformer },
        { provide: TenantModelFactory, useValue: tenantModelFactoryMock },
      ],
    }).compile();

    return {
      moduleRef,
      processor: moduleRef.get(OverlayMetricsProcessor),
      extractor: { extractPlatformMetrics },
      transformer: { transformPlatformMetrics: transformer.transformPlatformMetrics },
      platformModel,
    };
  };

  const stripAuditFields = (
    items: StoredPlatformDoc[],
  ): PlatformMetricDto[] =>
    items.map(({ createdAt: _createdAt, updatedAt: _updatedAt, ...doc }) => doc);

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('rerun cùng interval sẽ accumulate raw counts và update derived metrics', async () => {
    const firstRunDocs: PlatformMetricDto[] = [
      buildPlatformMetric('web', {
        sent: 50,
        received: 46,
        rendered: 42,
        failed: 4,
        receiveRate: 92,
        renderRate: 84,
        failureRate: 8,
        netSuccessRate: 84,
        avgRenderMs: 110,
      }),
      buildPlatformMetric('ios', {
        sent: 30,
        received: 27,
        rendered: 25,
        failed: 3,
        receiveRate: 90,
        renderRate: 83.33,
        failureRate: 10,
        netSuccessRate: 83.33,
        avgRenderMs: 95,
      }),
      buildPlatformMetric('android', {
        sent: 20,
        received: 18,
        rendered: 17,
        failed: 2,
        receiveRate: 90,
        renderRate: 85,
        failureRate: 10,
        netSuccessRate: 85,
        avgRenderMs: 88,
      }),
    ];
    const secondRunDocs: PlatformMetricDto[] = [
      buildPlatformMetric('web', {
        sent: 70,
        received: 66,
        rendered: 61,
        failed: 4,
        receiveRate: 94.29,
        renderRate: 87.14,
        failureRate: 5.71,
        netSuccessRate: 87.14,
        avgRenderMs: 108,
      }),
      buildPlatformMetric('ios', {
        sent: 45,
        received: 42,
        rendered: 39,
        failed: 3,
        receiveRate: 93.33,
        renderRate: 86.67,
        failureRate: 6.67,
        netSuccessRate: 86.67,
        avgRenderMs: 91,
      }),
      buildPlatformMetric('android', {
        sent: 35,
        received: 32,
        rendered: 29,
        failed: 3,
        receiveRate: 91.43,
        renderRate: 82.86,
        failureRate: 8.57,
        netSuccessRate: 82.86,
        avgRenderMs: 85,
      }),
    ];

    const { moduleRef, processor, extractor, transformer, platformModel } =
      await createScenario([firstRunDocs, secondRunDocs]);

    try {
      await processor.process(buildJob('job-platform-first'));
      expect(platformModel.countDocuments()).toBe(3);

      await processor.process(buildJob('job-platform-rerun'));

      expect(extractor.extractPlatformMetrics).toHaveBeenCalledTimes(2);
      expect(transformer.transformPlatformMetrics).toHaveBeenCalledTimes(2);

      expect(platformModel.bulkWrite).toHaveBeenCalledTimes(2);

      const firstOps = platformModel.bulkWrite.mock.calls[0][0] as PlatformBulkWriteOp[];
      const secondOps = platformModel.bulkWrite.mock.calls[1][0] as PlatformBulkWriteOp[];

      expect(firstOps).toHaveLength(3);
      expect(secondOps).toHaveLength(3);

      // Filter dùng matchId, không phải timelineId
      for (const [index, platform] of ['web', 'ios', 'android'].entries()) {
        expect(firstOps[index].updateOne.filter).toEqual({
          tenantId,
          matchId,
          platform,
          intervalFrom,
        });
        expect(secondOps[index].updateOne.filter).toEqual(firstOps[index].updateOne.filter);
      }

      // Accumulate: raw counts cộng dồn, derived metrics lấy giá trị mới nhất
      expect(platformModel.countDocuments()).toBe(3);
      const storedDocs = stripAuditFields(platformModel.getDocuments());
      expect(storedDocs).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            platform: 'web',
            sent: 120, // 50 + 70
            received: 112, // 46 + 66
            rendered: 103, // 42 + 61
            failed: 8, // 4 + 4
            receiveRate: 94.29, // derived từ lần 2
            avgRenderMs: 108, // derived từ lần 2
          }),
          expect.objectContaining({
            platform: 'ios',
            sent: 75, // 30 + 45
            received: 69, // 27 + 42
            rendered: 64, // 25 + 39
            failed: 6, // 3 + 3
            receiveRate: 93.33,
            avgRenderMs: 91,
          }),
          expect.objectContaining({
            platform: 'android',
            sent: 55, // 20 + 35
            received: 50, // 18 + 32
            rendered: 46, // 17 + 29
            failed: 5, // 2 + 3
            receiveRate: 91.43,
            avgRenderMs: 85,
          }),
        ]),
      );
    } finally {
      await moduleRef.close();
    }
  });

  it('rerun lần 2 có platform mới thì chỉ thêm doc mới, còn doc cũ vẫn accumulate', async () => {
    const firstRunDocs: PlatformMetricDto[] = [
      buildPlatformMetric('web', {
        sent: 40,
        received: 36,
        rendered: 34,
        failed: 4,
        receiveRate: 90,
        renderRate: 85,
        failureRate: 10,
        netSuccessRate: 85,
        avgRenderMs: 111,
      }),
      buildPlatformMetric('ios', {
        sent: 35,
        received: 32,
        rendered: 30,
        failed: 3,
        receiveRate: 91.43,
        renderRate: 85.71,
        failureRate: 8.57,
        netSuccessRate: 85.71,
        avgRenderMs: 97,
      }),
      buildPlatformMetric('android', {
        sent: 25,
        received: 22,
        rendered: 20,
        failed: 3,
        receiveRate: 88,
        renderRate: 80,
        failureRate: 12,
        netSuccessRate: 80,
        avgRenderMs: 90,
      }),
    ];
    const secondRunDocs: PlatformMetricDto[] = [
      buildPlatformMetric('web', {
        sent: 55,
        received: 50,
        rendered: 47,
        failed: 5,
        receiveRate: 90.91,
        renderRate: 85.45,
        failureRate: 9.09,
        netSuccessRate: 85.45,
        avgRenderMs: 109,
      }),
      buildPlatformMetric('ios', {
        sent: 45,
        received: 41,
        rendered: 39,
        failed: 4,
        receiveRate: 91.11,
        renderRate: 86.67,
        failureRate: 8.89,
        netSuccessRate: 86.67,
        avgRenderMs: 94,
      }),
      buildPlatformMetric('android', {
        sent: 30,
        received: 27,
        rendered: 24,
        failed: 3,
        receiveRate: 90,
        renderRate: 80,
        failureRate: 10,
        netSuccessRate: 80,
        avgRenderMs: 87,
      }),
      buildPlatformMetric('smarttv', {
        sent: 20,
        received: 18,
        rendered: 16,
        failed: 2,
        receiveRate: 90,
        renderRate: 80,
        failureRate: 10,
        netSuccessRate: 80,
        avgRenderMs: 120,
      }),
    ];

    const { moduleRef, processor, platformModel } = await createScenario([
      firstRunDocs,
      secondRunDocs,
    ]);

    try {
      await processor.process(buildJob('job-platform-new-1'));
      expect(platformModel.countDocuments()).toBe(3);

      await processor.process(buildJob('job-platform-new-2'));

      const secondOps = platformModel.bulkWrite.mock.calls[1][0] as PlatformBulkWriteOp[];

      expect(secondOps).toHaveLength(4);
      expect(secondOps).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            updateOne: expect.objectContaining({
              filter: expect.objectContaining({
                tenantId,
                matchId,
                platform: 'web',
                intervalFrom,
              }),
              upsert: true,
            }),
          }),
          expect.objectContaining({
            updateOne: expect.objectContaining({
              filter: expect.objectContaining({
                tenantId,
                matchId,
                platform: 'smarttv',
                intervalFrom,
              }),
              upsert: true,
            }),
          }),
        ]),
      );

      expect(platformModel.countDocuments()).toBe(4);
      const storedDocs = stripAuditFields(platformModel.getDocuments());
      expect(storedDocs).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ platform: 'web', sent: 95 }), // 40 + 55
          expect.objectContaining({ platform: 'ios', sent: 80 }), // 35 + 45
          expect.objectContaining({ platform: 'android', sent: 55 }), // 25 + 30
          expect.objectContaining({ platform: 'smarttv', sent: 20 }),
        ]),
      );
    } finally {
      await moduleRef.close();
    }
  });
});
