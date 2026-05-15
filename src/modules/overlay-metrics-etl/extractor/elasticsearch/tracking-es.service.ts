import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ElasticsearchService } from '@nestjs/elasticsearch';
import { TrackingAggQuery } from '../dto/tracking-agg-query.dto';
import {
  PlatformMetricsAggs,
  DeviceBreakdownAggs,
  TransportComparisonAggs,
  SdkVersionAggs,
  FailureAggs,
  LatencyAggs,
  TimeseriesAggs,
} from './types/tracking-es-aggs.types';

/**
 * Wrapper chung cho kết quả aggregation từ Elasticsearch.
 *
 * @template TAggs - Kiểu aggregation được định nghĩa trong `tracking-es-aggs.types`.
 */
export interface TrackingAggResult<TAggs = Record<string, unknown>> {
  aggregations?: TAggs;
  took: number;
}

/**
 * Service thực thi tất cả các Elasticsearch aggregation queries
 * trên index `tracking-events-*`.
 *
 * Dùng flat-query style của **Elasticsearch Client v9** (không có wrapper `body`).
 * Mỗi public method tương ứng với một tab của màn "Chỉ số bản overlay",
 * trả về dữ liệu đã aggregate sẵn để {@link TransformerService} chỉ cần map shape.
 *
 * @see {@link ExtractorService} — facade delegate xuống service này.
 */
@Injectable()
export class TrackingEsService {
  private readonly logger = new Logger(TrackingEsService.name);

  constructor(
    private readonly esService: ElasticsearchService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * **Tab Tổng quan** — Platform metrics.
   *
   * Cấu trúc aggregation:
   * ```
   * terms(labels.platform)
   *   ├── sent:     filter(stage=sent)     → sum(numeric_labels.room_size)
   *   ├── received: filter(stage=received) → doc_count
   *   ├── rendered: filter(stage=rendered) → avg(numeric_labels.render_duration_ms)
   *   └── failed:   filter(stage=render-failed) → doc_count
   * ```
   */
  async queryPlatformMetrics(
    query: TrackingAggQuery,
  ): Promise<TrackingAggResult<PlatformMetricsAggs>> {
    const esQuery = this.buildBaseQuery(query);

    this.logger.debug(`ES search platformMetrics — index=${this.getIndex()}`);
    const result = await this.esService.search<unknown, PlatformMetricsAggs>(
      {
        index: this.getIndex(),
        size: 0,
        query: esQuery,
        aggs: {
          platforms: {
            terms: { field: 'labels.platform', size: 100, missing: 'unknown' },
            aggs: {
              sent: {
                filter: { term: { 'labels.stage': 'sent' } },
                aggs: {
                  room_size_sum: { sum: { field: 'numeric_labels.room_size' } },
                },
              },
              received: { filter: { term: { 'labels.stage': 'received' } } },
              rendered: {
                filter: { term: { 'labels.stage': 'rendered' } },
                aggs: {
                  avg_render_ms: {
                    avg: { field: 'numeric_labels.render_duration_ms' },
                  },
                },
              },
              failed: { filter: { term: { 'labels.stage': 'render-failed' } } },
            },
          },
        },
      },
      { requestTimeout: this.getRequestTimeout() },
    );

    const buckets = result.aggregations?.platforms?.buckets?.length ?? 0;
    this.logger.debug(`ES platformMetrics done — took=${result.took}ms buckets=${buckets}`);
    return {
      aggregations: result.aggregations,
      took: result.took,
    };
  }

  /**
   * **Tab Thiết bị** — Device breakdown theo dimension.
   *
   * Dimensions hỗ trợ: `browser`, `os`, `deviceClass`.
   *
   * Cấu trúc aggregation:
   * ```
   * terms(labels.browser | labels.client_os | labels.device_class)
   *   └── by_stage: filters(received, rendered, render-failed)
   *         └── avg(numeric_labels.render_duration_ms)
   * ```
   */
  async queryDeviceBreakdown(
    query: TrackingAggQuery,
    dimension: string,
  ): Promise<TrackingAggResult<DeviceBreakdownAggs>> {
    const fieldMap: Record<string, string> = {
      browser: 'labels.browser',
      os: 'labels.client_os',
      deviceClass: 'labels.device_class',
    };

    const esQuery = this.buildBaseQuery(query);

    const result = await this.esService.search<unknown, DeviceBreakdownAggs>(
      {
        index: this.getIndex(),
        size: 0,
        query: esQuery,
        aggs: {
          by_dimension: {
            terms: {
              field: fieldMap[dimension] || fieldMap.browser,
              size: 50,
              missing: 'unknown',
            },
            aggs: {
              by_stage: {
                filters: {
                  filters: {
                    received: { term: { 'labels.stage': 'received' } },
                    rendered: { term: { 'labels.stage': 'rendered' } },
                    failed: { term: { 'labels.stage': 'render-failed' } },
                  },
                },
                aggs: {
                  avg_render_ms: {
                    avg: { field: 'numeric_labels.render_duration_ms' },
                  },
                },
              },
            },
          },
        },
      },
      { requestTimeout: this.getRequestTimeout() },
    );

    return {
      aggregations: result.aggregations,
      took: result.took,
    };
  }

  /**
   * **Tab Transport** — So sánh transport mode.
   *
   * Cấu trúc aggregation:
   * ```
   * terms(labels.transport_mode)
   *   └── by_stage: filters(received, rendered)
   *         ├── avg(numeric_labels.render_duration_ms)
   *         └── percentiles(numeric_labels.render_duration_ms, [95])
   * ```
   */
  async queryTransportComparison(
    query: TrackingAggQuery,
  ): Promise<TrackingAggResult<TransportComparisonAggs>> {
    const esQuery = this.buildBaseQuery(query);

    const result = await this.esService.search<
      unknown,
      TransportComparisonAggs
    >(
      {
        index: this.getIndex(),
        size: 0,
        query: esQuery,
        aggs: {
          by_transport: {
            terms: {
              field: 'labels.transport_mode',
              size: 10,
              missing: 'unknown',
            },
            aggs: {
              by_stage: {
                filters: {
                  filters: {
                    received: { term: { 'labels.stage': 'received' } },
                    rendered: { term: { 'labels.stage': 'rendered' } },
                  },
                },
                aggs: {
                  avg_render_ms: {
                    avg: { field: 'numeric_labels.render_duration_ms' },
                  },
                  p95_render_ms: {
                    percentiles: {
                      field: 'numeric_labels.render_duration_ms',
                      percents: [95],
                    },
                  },
                },
              },
            },
          },
        },
      },
      { requestTimeout: this.getRequestTimeout() },
    );

    return {
      aggregations: result.aggregations,
      took: result.took,
    };
  }

  /**
   * **Tab SDK** — Phân bố theo SDK version.
   *
   * Cấu trúc aggregation:
   * ```
   * terms(labels.sdk_version)
   *   └── by_stage: filters(received, rendered)
   *         └── avg(numeric_labels.render_duration_ms)
   * ```
   */
  async querySdkVersions(
    query: TrackingAggQuery,
  ): Promise<TrackingAggResult<SdkVersionAggs>> {
    const esQuery = this.buildBaseQuery(query);

    const result = await this.esService.search<unknown, SdkVersionAggs>(
      {
        index: this.getIndex(),
        size: 0,
        query: esQuery,
        aggs: {
          by_sdk_version: {
            terms: {
              field: 'labels.sdk_version',
              size: 50,
              missing: 'unknown',
            },
            aggs: {
              by_stage: {
                filters: {
                  filters: {
                    received: { term: { 'labels.stage': 'received' } },
                    rendered: { term: { 'labels.stage': 'rendered' } },
                  },
                },
                aggs: {
                  avg_render_ms: {
                    avg: { field: 'numeric_labels.render_duration_ms' },
                  },
                },
              },
            },
          },
        },
      },
      { requestTimeout: this.getRequestTimeout() },
    );

    return {
      aggregations: result.aggregations,
      took: result.took,
    };
  }

  /**
   * **Tab Lỗi** — Phân tích lý do và bước lỗi.
   *
   * Cấu trúc aggregation:
   * ```
   * terms(labels.failure_reason)
   *   └── terms(labels.failure_step)
   * ```
   *
   * {@link TransformerService} sẽ tính `percentOfFailed` bằng cách
   * chia từng bucket cho tổng số failed.
   */
  async queryFailures(
    query: TrackingAggQuery,
  ): Promise<TrackingAggResult<FailureAggs>> {
    const esQuery = this.buildBaseQuery(query);

    const result = await this.esService.search<unknown, FailureAggs>(
      {
        index: this.getIndex(),
        size: 0,
        query: esQuery,
        aggs: {
          by_reason: {
            terms: { field: 'labels.failure_reason', size: 50 },
            aggs: {
              by_step: { terms: { field: 'labels.failure_step', size: 20 } },
            },
          },
        },
      },
      { requestTimeout: this.getRequestTimeout() },
    );

    return {
      aggregations: result.aggregations,
      took: result.took,
    };
  }

  /**
   * **Tab Latency** — Percentiles và stats độ trễ.
   *
   * Dùng **top-level aggregations** (không split bucket) vì latency
   * được báo cáo một lần cho mỗi timeline interval.
   *
   * Cấu trúc aggregation:
   * ```
   * receive_latency:  percentiles(numeric_labels.receive_latency_ms,  [50,75,95,99])
   * render_latency:   percentiles(numeric_labels.render_duration_ms,   [50,75,95,99])
   * ack_latency:      percentiles(numeric_labels.ack_latency_ms,       [50,75,95,99])
   * receive_stats:    stats(numeric_labels.receive_latency_ms)
   * render_stats:     stats(numeric_labels.render_duration_ms)
   * ack_stats:        stats(numeric_labels.ack_latency_ms)
   * ```
   *
   * `renderDuration` trong DTO được map từ `render_latency` / `render_stats`
   * thay vì aggregation riêng để tránh query redundant.
   */
  async queryLatency(
    query: TrackingAggQuery,
  ): Promise<TrackingAggResult<LatencyAggs>> {
    const esQuery = this.buildBaseQuery(query);

    this.logger.debug(`ES search latency — index=${this.getIndex()}`);
    const result = await this.esService.search<unknown, LatencyAggs>(
      {
        index: this.getIndex(),
        size: 0,
        query: esQuery,
        aggs: {
          receive_latency: {
            percentiles: {
              field: 'numeric_labels.receive_latency_ms',
              percents: [50, 75, 95, 99],
            },
          },
          render_latency: {
            percentiles: {
              field: 'numeric_labels.render_duration_ms',
              percents: [50, 75, 95, 99],
            },
          },
          ack_latency: {
            percentiles: {
              field: 'numeric_labels.ack_latency_ms',
              percents: [50, 75, 95, 99],
            },
          },
          receive_stats: {
            stats: { field: 'numeric_labels.receive_latency_ms' },
          },
          render_stats: {
            stats: { field: 'numeric_labels.render_duration_ms' },
          },
          ack_stats: { stats: { field: 'numeric_labels.ack_latency_ms' } },
        },
      },
      { requestTimeout: this.getRequestTimeout() },
    );

    this.logger.debug(`ES latency done — took=${result.took}ms hasAggs=${!!result.aggregations}`);
    return {
      aggregations: result.aggregations,
      took: result.took,
    };
  }

  /**
   * **Tab Thời gian** — Dữ liệu timeseries.
   *
   * Cấu trúc aggregation:
   * ```
   * date_histogram(@timestamp, fixed_interval)
   *   └── metric_value: agg động theo metric
   * ```
   *
   * Metric mapping:
   * | Metric       | Agg type | Field                           |
   * |--------------|----------|---------------------------------|
   * | `sent`       | `sum`    | `numeric_labels.room_size`      |
   * | `received`   | `filter` | `labels.stage: received`        |
   * | `rendered`   | `filter` | `labels.stage: rendered`        |
   * | `failed`     | `filter` | `labels.stage: render-failed`   |
   * | `avgRenderMs`| `avg`    | `numeric_labels.render_duration_ms` |
   *
   * @throws Nếu metric không được hỗ trợ.
   */
  async queryTimeseries(
    query: TrackingAggQuery,
    metric: string,
    interval: string,
  ): Promise<TrackingAggResult<TimeseriesAggs>> {
    const esQuery = this.buildBaseQuery(query);

    const metricMap: Record<string, { type: string; field?: string }> = {
      sent: { type: 'sum', field: 'numeric_labels.room_size' },
      received: { type: 'count' },
      rendered: { type: 'count' },
      failed: { type: 'count' },
      avgRenderMs: { type: 'avg', field: 'numeric_labels.render_duration_ms' },
    };

    const config = metricMap[metric];
    if (!config) {
      throw new Error(`Unsupported timeseries metric: ${metric}`);
    }

    let metricAgg: Record<string, unknown>;

    if (config.type === 'sum') {
      metricAgg = { sum: { field: config.field } };
    } else if (config.type === 'avg') {
      metricAgg = { avg: { field: config.field } };
    } else if (['received', 'rendered', 'failed'].includes(metric)) {
      const stageMap: Record<string, string> = {
        received: 'received',
        rendered: 'rendered',
        failed: 'render-failed',
      };
      metricAgg = { filter: { term: { 'labels.stage': stageMap[metric] } } };
    } else {
      throw new Error(`Unsupported timeseries metric: ${metric}`);
    }

    const result = await this.esService.search<unknown, TimeseriesAggs>(
      {
        index: this.getIndex(),
        size: 0,
        query: esQuery,
        aggs: {
          timeseries: {
            date_histogram: { field: '@timestamp', fixed_interval: interval },
            aggs: { metric_value: metricAgg },
          },
        },
      },
      { requestTimeout: this.getRequestTimeout() },
    );

    return {
      aggregations: result.aggregations,
      took: result.took,
    };
  }

  /** Lấy index pattern tracking từ config (mặc định `tracking-events-*`). */
  private getIndex(): string {
    return (
      this.configService.get<string>('elasticsearch.trackingIndex') ||
      'tracking-events-*'
    );
  }

  /** Lấy request timeout từ config (mặc định 10_000 ms). */
  private getRequestTimeout(): number {
    return (
      this.configService.get<number>('elasticsearch.trackingTimeoutMs') || 10000
    );
  }

  /**
   * Xây dựng `bool.must` filter dùng chung cho mọi aggregation query.
   *
   * Luôn bao gồm:
   * - `labels.tenant_id`
   * - `labels.environment` (từ `app.elasticApmEnvironment`)
   *
   * Tùy chọn thêm:
   * - `labels.timeline_id` (terms)
   * - `labels.media_content_id` (term)
   * - `@timestamp` range (`gte` / `lt`)
   * - `labels.platform` (term)
   *
   * @throws Nếu `tenantId` bị thiếu.
   */
  private buildBaseQuery(query: TrackingAggQuery): Record<string, unknown> {
    if (!query.tenantId) {
      throw new Error('tenantId is required for Elasticsearch queries');
    }

    const must: Record<string, unknown>[] = [
      { term: { 'labels.tenant_id': query.tenantId } },
    ];

    const env =
      query.environment !== undefined
        ? query.environment
        : this.configService.get<string>(
            'app.elasticApmEnvironment',
            'development',
          );

    if (env !== null) {
      must.push({
        term: {
          'labels.environment': env,
        },
      });
    }

    if (query.timelineIds?.length) {
      must.push({ terms: { 'labels.timeline_id': query.timelineIds } });
    }

    if (query.mediaContentId) {
      must.push({ term: { 'labels.media_content_id': query.mediaContentId } });
    }

    const rangeFilter: Record<string, string> = {};
    if (query.from) {
      rangeFilter.gte = query.from.toISOString();
    }
    if (query.to) {
      rangeFilter.lt = query.to.toISOString();
    }
    if (Object.keys(rangeFilter).length > 0) {
      must.push({
        range: {
          '@timestamp': rangeFilter,
        },
      });
    }

    if (query.platform) {
      must.push({ term: { 'labels.platform': query.platform } });
    }

    const built = { bool: { must } };
    this.logger.debug(JSON.stringify({ esBuiltQuery: built, inputQuery: query }));
    return built;
  }
}
