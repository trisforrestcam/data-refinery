import { Logger } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { TimelineProcessorService } from '@modules/overlay-metrics-etl/kafka/timeline-processor.service';
import { METRIC_PIPELINES } from '@modules/overlay-metrics-etl/pipelines/pipelines.module';
import { MetricPipeline } from '@modules/overlay-metrics-etl/pipelines/metric-pipeline.interface';
import { MetricType } from '@domain/enums/metric-type.enum';
import { PipelineContext } from '@modules/overlay-metrics-etl/pipelines/pipeline.context';

describe('UC-01 - Full ETL pipeline cho 1 trận đấu live', () => {
  let moduleRef: TestingModule;
  let timelineProcessor: TimelineProcessorService;
  let pipelines: MetricPipeline[];
  let logSpy: jest.SpyInstance;

  const fixedNow = new Date('2024-01-15T10:05:00.000Z');
  const expectedIntervalFrom = new Date('2024-01-15T10:00:00.000Z');
  const expectedIntervalTo = fixedNow;
  const expectedContext = {
    tenantId: 'tenant-abc',
    matchId: 'match-123',
    timelineId: 'tl-001',
    intervalFrom: expectedIntervalFrom,
    intervalTo: expectedIntervalTo,
    query: {
      timelineIds: ['tl-001'],
      tenantId: 'tenant-abc',
      from: expectedIntervalFrom,
      to: expectedIntervalTo,
    },
  };
  const payload = {
    tenantId: 'tenant-abc',
    matchId: 'match-123',
    timelineId: 'tl-001',
    timeRangeMinutes: 5,
  };

  const totalCalls = (items: MetricPipeline[]): number =>
    items.reduce(
      (sum, p) => sum + (p.execute as jest.Mock).mock.calls.length,
      0,
    );

  const allContexts = (): PipelineContext[] =>
    pipelines.map((p) => (p.execute as jest.Mock).mock.calls[0][0]);

  beforeEach(async () => {
    jest.useFakeTimers().setSystemTime(fixedNow);
    logSpy = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);

    pipelines = [
      {
        type: MetricType.PLATFORM,
        execute: jest.fn().mockResolvedValue(undefined),
      },
      {
        type: MetricType.DEVICE,
        execute: jest.fn().mockResolvedValue(undefined),
      },
      {
        type: MetricType.TRANSPORT,
        execute: jest.fn().mockResolvedValue(undefined),
      },
      { type: MetricType.SDK, execute: jest.fn().mockResolvedValue(undefined) },
      {
        type: MetricType.FAILURE,
        execute: jest.fn().mockResolvedValue(undefined),
      },
      {
        type: MetricType.LATENCY,
        execute: jest.fn().mockResolvedValue(undefined),
      },
      {
        type: MetricType.TIMESERIES,
        execute: jest.fn().mockResolvedValue(undefined),
      },
    ];

    moduleRef = await Test.createTestingModule({
      providers: [
        TimelineProcessorService,
        { provide: METRIC_PIPELINES, useValue: pipelines },
      ],
    }).compile();

    timelineProcessor = moduleRef.get(TimelineProcessorService);
    logSpy.mockClear();
  });

  afterEach(async () => {
    await moduleRef.close();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('chạy đủ pipeline ETL tổng thể cho 1 timeline của trận live với đúng 7 pipelines', async () => {
    // Nghiệp vụ: 1 job xử lý đủ 7 metric pipelines cho trận live.
    await timelineProcessor.processTimeline(payload);

    expect(totalCalls(pipelines)).toBe(7);

    for (const pipeline of pipelines) {
      expect(pipeline.execute).toHaveBeenCalledTimes(1);
    }
  });

  it('tạo PipelineContext đúng theo tenant, match, timeline và cửa sổ 5 phút', async () => {
    // Nghiệp vụ: dữ liệu của trận live chỉ được aggregate trong cửa sổ [now - 5 phút, now].
    await timelineProcessor.processTimeline(payload);

    expect(allContexts()).toHaveLength(7);
    for (const ctx of allContexts()) {
      expect(ctx).toEqual(expectedContext);
    }
  });

  it('1 pipeline fail → các pipeline khác vẫn chạy và throw tổng hợp', async () => {
    // Nghiệp vụ: lỗi 1 pipeline không được crash toàn bộ timeline.
    (pipelines[3].execute as jest.Mock).mockRejectedValueOnce(
      new Error('SDK pipeline failed'),
    );

    await expect(timelineProcessor.processTimeline(payload)).rejects.toThrow(
      'tl-001 failed pipelines: sdk',
    );

    // Các pipeline vẫn được gọi
    for (const pipeline of pipelines) {
      expect(pipeline.execute).toHaveBeenCalledTimes(1);
    }
  });

  it('ghi log đúng format khi tất cả pipelines hoàn thành', async () => {
    // Nghiệp vụ: operator cần log xác nhận timeline xử lý xong.
    await timelineProcessor.processTimeline(payload);

    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy).toHaveBeenCalledWith(
      'Timeline tl-001 — all 7 pipelines completed',
    );
  });
});
