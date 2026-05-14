import { Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';
import { InjectQueue } from '@nestjs/bullmq';
import { OverlayMetricsRepository } from '@infrastructure/persistence/overlay-metrics.repository';
import { MetricType } from '@domain/enums/metric-type.enum';
import { MetricsQueryDto } from './dto/metrics-query.dto';
import { BackfillJobDto } from './dto/backfill-job.dto';
import {
  OVERLAY_METRICS_QUEUE,
  OVERLAY_METRICS_JOB,
} from '@common/constants/scheduler.constants';

/**
 * Build MongoDB filter từ query params + tenantId.
 * Tách logic filter ra khỏi service để dễ unit test và tái sử dụng.
 */
function buildFilter(
  tenantId: string,
  query: MetricsQueryDto,
): Record<string, any> {
  const filter: Record<string, any> = { tenantId };

  if (query.matchId) {
    filter.matchId = query.matchId;
  }

  if (query.timelineIds && query.timelineIds.length > 0) {
    filter.timelineId = { $in: query.timelineIds };
  }

  if (query.from || query.to) {
    filter.intervalFrom = {};
    if (query.from) filter.intervalFrom.$gte = new Date(query.from);
    if (query.to) filter.intervalFrom.$lte = new Date(query.to);
  }

  return filter;
}

/**
 * Service phục vụ API read metrics từ MongoDB.
 * Không chứa logic phức tạp — chỉ build filter và delegate cho Repository.
 * Tách biệt rõ với LoaderService (write) để tránh nhầm lẫn.
 */
@Injectable()
export class MetricsApiService {
  constructor(
    private readonly repository: OverlayMetricsRepository,
    @InjectQueue(OVERLAY_METRICS_QUEUE)
    private readonly queue: Queue,
  ) {}

  /**
   * Lấy platform metrics: tỷ lệ nhận, render, lỗi theo platform.
   * Dùng cho tab "Tổng quan" trên dashboard overlay.
   */
  async getPlatformMetrics(tenantId: string, query: MetricsQueryDto) {
    return this.repository.find(MetricType.PLATFORM, buildFilter(tenantId, query));
  }

  /**
   * Lấy device breakdown: phân bố ngườ dùng theo browser/OS/device class.
   * Dùng cho tab "Thiết bị" trên dashboard.
   */
  async getDeviceBreakdown(tenantId: string, query: MetricsQueryDto) {
    return this.repository.find(MetricType.DEVICE, buildFilter(tenantId, query));
  }

  /**
   * Lấy transport comparison: hiệu suất WebSocket vs Long Polling.
   * Dùng cho tab "Transport" trên dashboard.
   */
  async getTransportComparison(tenantId: string, query: MetricsQueryDto) {
    return this.repository.find(MetricType.TRANSPORT, buildFilter(tenantId, query));
  }

  /**
   * Lấy SDK version distribution.
   * Dùng cho tab "SDK" — xem version nào đang được dùng nhiều nhất.
   */
  async getSdkVersions(tenantId: string, query: MetricsQueryDto) {
    return this.repository.find(MetricType.SDK, buildFilter(tenantId, query));
  }

  /**
   * Lấy failure analysis: lý do lỗi + bước xảy ra lỗi.
   * Dùng cho tab "Lỗi" — giúp dev định vị nhanh nguyên nhân.
   */
  async getFailures(tenantId: string, query: MetricsQueryDto) {
    return this.repository.find(MetricType.FAILURE, buildFilter(tenantId, query));
  }

  /**
   * Lấy latency percentiles: p50/p75/p95/p99 cho receive, render, ack.
   * Dùng cho tab "Latency" — đánh giá độ trễ hệ thống.
   */
  async getLatency(tenantId: string, query: MetricsQueryDto) {
    return this.repository.find(MetricType.LATENCY, buildFilter(tenantId, query));
  }

  /**
   * Lấy timeseries data: điểm dữ liệu theo thờ gian để vẽ biểu đồ xu hướng.
   * Có thể filter thêm theo metric name (sent, received, rendered, failed, avgRenderMs).
   * Dùng cho biểu đồ thờ gian trên dashboard.
   */
  async getTimeseries(tenantId: string, query: MetricsQueryDto, metric?: string) {
    const filter = buildFilter(tenantId, query);
    if (metric) {
      filter.metric = metric;
    }
    return this.repository.find(MetricType.TIMESERIES, filter);
  }

  /**
   * Enqueue backfill job vào BullMQ queue để tính lại metrics cho match cụ thể.
   * Job sẽ được processor xử lý async — accumulate data thay vì ghi đè.
   */
  async triggerBackfill(tenantId: string, dto: BackfillJobDto) {
    const jobData = {
      name: OVERLAY_METRICS_JOB,
      data: {
        tenantId: dto.tenantId || tenantId,
        matchId: dto.matchId,
        timelineIds: dto.timelineIds,
        timeRangeMinutes: dto.timeRangeMinutes ?? 5,
        ...(dto.intervalFrom ? { intervalFrom: dto.intervalFrom } : {}),
        ...(dto.intervalTo ? { intervalTo: dto.intervalTo } : {}),
      },
      opts: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
      },
    };

    const job = await this.queue.add(jobData.name, jobData.data, jobData.opts);

    return {
      jobId: job.id,
      status: 'enqueued',
      tenantId: dto.tenantId || tenantId,
      matchId: dto.matchId,
      timelineIds: dto.timelineIds,
      intervalFrom: dto.intervalFrom,
      intervalTo: dto.intervalTo,
      timeRangeMinutes: dto.timeRangeMinutes ?? 5,
    };
  }
}
