import { Logger } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JobProducerService } from '@modules/overlay-metrics-etl/kafka/job-producer.service';
import { SchedulerConfigService } from '@modules/overlay-metrics-etl/scheduler/scheduler-config.service';
import { KafkaProducerService } from '@modules/overlay-metrics-etl/kafka/kafka-producer.service';
import { BackfillJobDto } from '@modules/overlay-metrics-api/dto/backfill-job.dto';

describe('JobProducerService', () => {
  let service: JobProducerService;
  let kafkaProducer: { sendJob: jest.Mock };
  let schedulerConfig: { getActiveTargets: jest.Mock };

  beforeEach(async () => {
    kafkaProducer = { sendJob: jest.fn().mockResolvedValue(undefined) };
    schedulerConfig = { getActiveTargets: jest.fn().mockResolvedValue([]) };

    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        JobProducerService,
        { provide: SchedulerConfigService, useValue: schedulerConfig },
        { provide: KafkaProducerService, useValue: kafkaProducer },
      ],
    }).compile();

    service = moduleRef.get(JobProducerService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('handleCron', () => {
    it('2 targets với 3 timelines mỗi target → 6 sendJob calls', async () => {
      schedulerConfig.getActiveTargets.mockResolvedValue([
        {
          tenantId: 'tenant-a',
          matchId: 'match-1',
          timelineIds: ['tl-1', 'tl-2', 'tl-3'],
        },
        {
          tenantId: 'tenant-b',
          matchId: 'match-2',
          timelineIds: ['tl-4', 'tl-5', 'tl-6'],
        },
      ]);

      await service.handleCron();

      expect(kafkaProducer.sendJob).toHaveBeenCalledTimes(6);

      const calls = kafkaProducer.sendJob.mock.calls.map((c) => c[0]);
      expect(calls).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            tenantId: 'tenant-a',
            matchId: 'match-1',
            timelineId: 'tl-1',
            timeRangeMinutes: 60,
            origin: 'scheduled',
          }),
          expect.objectContaining({
            tenantId: 'tenant-a',
            matchId: 'match-1',
            timelineId: 'tl-2',
            timeRangeMinutes: 60,
            origin: 'scheduled',
          }),
          expect.objectContaining({
            tenantId: 'tenant-a',
            matchId: 'match-1',
            timelineId: 'tl-3',
            timeRangeMinutes: 60,
            origin: 'scheduled',
          }),
          expect.objectContaining({
            tenantId: 'tenant-b',
            matchId: 'match-2',
            timelineId: 'tl-4',
            timeRangeMinutes: 60,
            origin: 'scheduled',
          }),
          expect.objectContaining({
            tenantId: 'tenant-b',
            matchId: 'match-2',
            timelineId: 'tl-5',
            timeRangeMinutes: 60,
            origin: 'scheduled',
          }),
          expect.objectContaining({
            tenantId: 'tenant-b',
            matchId: 'match-2',
            timelineId: 'tl-6',
            timeRangeMinutes: 60,
            origin: 'scheduled',
          }),
        ]),
      );
    });

    it('0 targets → không gọi sendJob và log warning', async () => {
      schedulerConfig.getActiveTargets.mockResolvedValue([]);
      const warnSpy = jest
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => undefined);

      await service.handleCron();

      expect(kafkaProducer.sendJob).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          'Overlay metrics scheduler: no active targets found',
        ),
      );
    });

    it('1 target với 1 timeline → 1 sendJob call', async () => {
      schedulerConfig.getActiveTargets.mockResolvedValue([
        { tenantId: 'tenant-c', matchId: 'match-3', timelineIds: ['tl-7'] },
      ]);

      await service.handleCron();

      expect(kafkaProducer.sendJob).toHaveBeenCalledTimes(1);
      expect(kafkaProducer.sendJob).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: 'tenant-c',
          matchId: 'match-3',
          timelineId: 'tl-7',
          timeRangeMinutes: 60,
          origin: 'scheduled',
        }),
      );
    });
  });

  describe('triggerBackfill', () => {
    it('dto với 2 timelineIds → 2 sendJob calls với origin=backfill và trả về correlationId', async () => {
      const dto: BackfillJobDto = {
        tenantId: 'tenant-001',
        matchId: 'match-123',
        timelineIds: ['tl-backfill-1', 'tl-backfill-2'],
        timeRangeMinutes: 5,
        intervalFrom: '2024-01-01T00:00:00Z',
        intervalTo: '2024-01-01T00:05:00Z',
      };

      const result = await service.triggerBackfill('tenant-001', dto);

      expect(kafkaProducer.sendJob).toHaveBeenCalledTimes(2);
      expect(kafkaProducer.sendJob).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          tenantId: 'tenant-001',
          matchId: 'match-123',
          timelineId: 'tl-backfill-1',
          timeRangeMinutes: 5,
          intervalFrom: '2024-01-01T00:00:00Z',
          intervalTo: '2024-01-01T00:05:00Z',
          origin: 'backfill',
          correlationId: expect.any(String),
        }),
      );
      expect(kafkaProducer.sendJob).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          tenantId: 'tenant-001',
          matchId: 'match-123',
          timelineId: 'tl-backfill-2',
          timeRangeMinutes: 5,
          intervalFrom: '2024-01-01T00:00:00Z',
          intervalTo: '2024-01-01T00:05:00Z',
          origin: 'backfill',
          correlationId: expect.any(String),
        }),
      );

      // Cả 2 message dùng chung correlationId
      const firstCall = kafkaProducer.sendJob.mock.calls[0][0];
      const secondCall = kafkaProducer.sendJob.mock.calls[1][0];
      expect(firstCall.correlationId).toBe(secondCall.correlationId);

      expect(result).toMatchObject({
        status: 'published',
        correlationId: firstCall.correlationId,
      });
    });
  });
});
