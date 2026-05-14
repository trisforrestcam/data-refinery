import { Injectable, Logger } from '@nestjs/common';
import { OverlayMetricsRepository } from '@infrastructure/persistence/overlay-metrics.repository';
import { MetricType } from '@domain/enums/metric-type.enum';
import type {
  PlatformMetricDto,
  DeviceBreakdownDto,
  TransportComparisonDto,
  SdkVersionDto,
  FailureAnalysisDto,
  TimeseriesPointDto,
  LatencyPercentileDto,
} from '@domain/dto';

/**
 * Loader nhận DTOs đã transform từ TransformerService và persist vào MongoDB.
 * Là tầng cuối cùng của ETL pipeline, chỉ delegate cho Repository để giữ sạch business logic.
 */
@Injectable()
export class LoaderService {
  private readonly logger = new Logger(LoaderService.name);

  constructor(private readonly repository: OverlayMetricsRepository) {}

  /**
   * Persist platform metrics: sent/received/rendered/failed + derived rates.
   * Dữ liệu này phục vụ tab "Tổng quan" — xem tỷ lệ nhận, render, lỗi theo platform.
   */
  async loadPlatformMetrics(items: PlatformMetricDto[]): Promise<void> {
    if (!items.length) return;
    await this.repository.upsert(MetricType.PLATFORM, items as unknown as Record<string, unknown>[]);
    this.logger.log(`Upserted ${items.length} platform metrics`);
  }

  /**
   * Persist device breakdown: browser, OS, device class.
   * Dữ liệu này phục vụ tab "Thiết bị" — phân tích phân bố ngườ dùng theo thiết bị.
   */
  async loadDeviceBreakdown(items: DeviceBreakdownDto[]): Promise<void> {
    if (!items.length) return;
    await this.repository.upsert(MetricType.DEVICE, items as unknown as Record<string, unknown>[]);
    this.logger.log(`Upserted ${items.length} device breakdowns`);
  }

  /**
   * Persist transport comparison: WebSocket vs Long Polling.
   * Dữ liệu này phục vụ tab "Transport" — so sánh hiệu suất giữa các protocol.
   */
  async loadTransportComparison(
    items: TransportComparisonDto[],
  ): Promise<void> {
    if (!items.length) return;
    await this.repository.upsert(MetricType.TRANSPORT, items as unknown as Record<string, unknown>[]);
    this.logger.log(`Upserted ${items.length} transport comparisons`);
  }

  /**
   * Persist SDK version distribution.
   * Dữ liệu này phục vụ tab "SDK" — xem version nào đang được dùng nhiều nhất.
   */
  async loadSdkVersions(items: SdkVersionDto[]): Promise<void> {
    if (!items.length) return;
    await this.repository.upsert(MetricType.SDK, items as unknown as Record<string, unknown>[]);
    this.logger.log(`Upserted ${items.length} SDK versions`);
  }

  /**
   * Persist failure analysis: lý do lỗi + bước lỗi.
   * Dữ liệu này phục vụ tab "Lỗi" — giúp dev biết lỗi thường xảy ra ở đâu.
   */
  async loadFailures(items: FailureAnalysisDto[]): Promise<void> {
    if (!items.length) return;
    await this.repository.upsert(MetricType.FAILURE, items as unknown as Record<string, unknown>[]);
    this.logger.log(`Upserted ${items.length} failures`);
  }

  /**
   * Persist timeseries data: điểm dữ liệu theo thờ gian (5m interval).
   * Dữ liệu này phục vụ biểu đồ xu hướng theo thờ gian trên UI.
   */
  async loadTimeseries(items: TimeseriesPointDto[]): Promise<void> {
    if (!items.length) return;
    await this.repository.upsert(MetricType.TIMESERIES, items as unknown as Record<string, unknown>[]);
    this.logger.log(`Upserted ${items.length} timeseries points`);
  }

  /**
   * Persist latency percentiles: p50/p75/p95/p99 cho receive, render, ack.
   * Dữ liệu này phục vụ tab "Latency" — đánh giá độ trễ hệ thống.
   */
  async loadLatency(items: LatencyPercentileDto[]): Promise<void> {
    if (!items.length) return;
    await this.repository.upsert(MetricType.LATENCY, items as unknown as Record<string, unknown>[]);
    this.logger.log(`Upserted ${items.length} latency records`);
  }
}
