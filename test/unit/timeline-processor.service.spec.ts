import { Logger } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { TimelineProcessorService } from '@modules/overlay-metrics-etl/kafka/timeline-processor.service';
import { METRIC_PIPELINES } from '@modules/overlay-metrics-etl/pipelines/pipelines.module';
import { MetricPipeline } from '@modules/overlay-metrics-etl/pipelines/metric-pipeline.interface';
import { MetricType } from '@domain/enums/metric-type.enum';
import { JobPayload } from '@modules/overlay-metrics-etl/kafka/kafka-producer.service';

describe('TimelineProcessorService', () => {
  let service: TimelineProcessorService;
  let pipelines: MetricPipeline[];

  const createPayload = (overrides?: Partial<JobPayload>): JobPayload => ({
    tenantId: 'tenant-001',
    matchId: 'match-123',
    timelineId: 'tl-001',
    timeRangeMinutes: 60,
    origin: 'scheduled',
    ...overrides,
  });

  beforeEach(async () => {
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

    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        TimelineProcessorService,
        { provide: METRIC_PIPELINES, useValue: pipelines },
      ],
    }).compile();

    service = moduleRef.get(TimelineProcessorService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('processTimeline gọi execute trên tất cả pipelines với đúng context', async () => {
    await service.processTimeline(createPayload());

    for (const pipeline of pipelines) {
      expect(pipeline.execute).toHaveBeenCalledTimes(1);
    }

    const firstCall = (pipelines[0].execute as jest.Mock).mock.calls[0][0];
    expect(firstCall).toMatchObject({
      tenantId: 'tenant-001',
      matchId: 'match-123',
      timelineId: 'tl-001',
      query: {
        timelineIds: ['tl-001'],
        tenantId: 'tenant-001',
      },
    });
    expect(firstCall.intervalFrom).toBeInstanceOf(Date);
    expect(firstCall.intervalTo).toBeInstanceOf(Date);
  });

  it('1 pipeline fail → các pipeline khác vẫn chạy và throw tổng hợp', async () => {
    (pipelines[3].execute as jest.Mock).mockRejectedValueOnce(
      new Error('SDK pipeline failed'),
    );

    await expect(service.processTimeline(createPayload())).rejects.toThrow(
      'tl-001 failed pipelines: sdk',
    );

    for (const pipeline of pipelines) {
      expect(pipeline.execute).toHaveBeenCalledTimes(1);
    }
  });

  it('payload không hợp lệ → throw error', async () => {
    await expect(service.processTimeline({} as JobPayload)).rejects.toThrow(
      'Invalid timeline payload',
    );
  });

  it('resolveInterval từ explicit intervalFrom/intervalTo', async () => {
    const payloadWithInterval = createPayload({
      intervalFrom: '2024-01-15T09:00:00.000Z',
      intervalTo: '2024-01-15T10:00:00.000Z',
    });

    await service.processTimeline(payloadWithInterval);

    const firstCall = (pipelines[0].execute as jest.Mock).mock.calls[0][0];
    expect(firstCall.intervalFrom).toEqual(
      new Date('2024-01-15T09:00:00.000Z'),
    );
    expect(firstCall.intervalTo).toEqual(new Date('2024-01-15T10:00:00.000Z'));
  });
});
