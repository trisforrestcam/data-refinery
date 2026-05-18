import { TrackingAggQuery } from '@modules/overlay-metrics-etl/extractor/dto/tracking-agg-query.dto';

/**
 * Context được truyền xuống tất cả metric pipelines.
 * Chứa đủ thông tin để extract, transform, và load cho 1 timeline cụ thể.
 */
export interface PipelineContext {
  /** Tenant cần aggregate. */
  tenantId: string;

  /** Match cần aggregate. */
  matchId: string;

  /** Timeline cụ thể trong match. */
  timelineId: string;

  /** Thờ điểm bắt đầu interval (inclusive). */
  intervalFrom: Date;

  /** Thờ điểm kết thúc interval (exclusive). */
  intervalTo: Date;

  /** Query object dùng chung cho tất cả ES aggregation calls. */
  query: TrackingAggQuery;
}
