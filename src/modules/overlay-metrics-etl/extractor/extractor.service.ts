import { Injectable } from '@nestjs/common';
import { TrackingEsService } from './elasticsearch/tracking-es.service';
import { TrackingAggQuery } from './dto/tracking-agg-query.dto';

/**
 * Facade cho Elasticsearch queries.
 * Không chứa logic phức tạp — chỉ delegate sang TrackingEsService.
 * Tồn tại để dễ thay đổi data source sau này (ví dụ: thêm cache, circuit breaker).
 */
@Injectable()
export class ExtractorService {
  constructor(private readonly trackingEsService: TrackingEsService) {}

  /**
   * Extract platform metrics từ ES: sent/received/rendered/failed theo platform.
   * Dùng cho tab "Tổng quan".
   */
  async extractPlatformMetrics(query: TrackingAggQuery) {
    return this.trackingEsService.queryPlatformMetrics(query);
  }

  /**
   * Extract device breakdown từ ES theo dimension (browser / os / deviceClass).
   * Chạy 3 lần trong pipeline để có đủ dữ liệu tab "Thiết bị".
   */
  async extractDeviceBreakdown(query: TrackingAggQuery, dimension: string) {
    return this.trackingEsService.queryDeviceBreakdown(query, dimension);
  }

  /**
   * Extract transport comparison từ ES: WebSocket vs Long Polling.
   * Dùng cho tab "Transport".
   */
  async extractTransportComparison(query: TrackingAggQuery) {
    return this.trackingEsService.queryTransportComparison(query);
  }

  /**
   * Extract SDK version distribution từ ES.
   * Dùng cho tab "SDK".
   */
  async extractSdkVersions(query: TrackingAggQuery) {
    return this.trackingEsService.querySdkVersions(query);
  }

  /**
   * Extract failure analysis từ ES: lý do lỗi × bước lỗi.
   * Dùng cho tab "Lỗi".
   */
  async extractFailures(query: TrackingAggQuery) {
    return this.trackingEsService.queryFailures(query);
  }

  /**
   * Extract latency percentiles từ ES: receive, render, ack.
   * Dùng cho tab "Latency".
   */
  async extractLatency(query: TrackingAggQuery) {
    return this.trackingEsService.queryLatency(query);
  }

  /**
   * Extract timeseries data từ ES cho biểu đồ xu hướng.
   * Chạy 5 lần (sent, received, rendered, failed, avgRenderMs) để có đủ series.
   */
  async extractTimeseries(
    query: TrackingAggQuery,
    metric: string,
    interval: string,
  ) {
    return this.trackingEsService.queryTimeseries(query, metric, interval);
  }
}
