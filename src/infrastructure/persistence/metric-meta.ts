import { MetricType } from '@domain/enums/metric-type.enum';

/**
 * Composite unique key cho mỗi metric type.
 * Dùng làm filter trong upsert để đảm bảo idempotency.
 * Tất cả đều dựa trên matchId thay vì timelineId để accumulate data từ nhiều timelines.
 */
export const UNIQUE_FIELDS: Record<MetricType, string[]> = {
  [MetricType.PLATFORM]: ['tenantId', 'matchId', 'platform', 'intervalFrom'],
  [MetricType.DEVICE]: ['tenantId', 'matchId', 'dimension', 'bucketKey', 'intervalFrom'],
  [MetricType.TRANSPORT]: ['tenantId', 'matchId', 'transportMode', 'intervalFrom'],
  [MetricType.SDK]: ['tenantId', 'matchId', 'sdkVersion', 'intervalFrom'],
  [MetricType.FAILURE]: ['tenantId', 'matchId', 'failureReason', 'failureStep', 'intervalFrom'],
  [MetricType.TIMESERIES]: ['tenantId', 'matchId', 'metric', 'interval', 'time'],
  [MetricType.LATENCY]: ['tenantId', 'matchId', 'intervalFrom'],
};

/**
 * Các numeric fields cần accumulate ($inc) thay vì ghi đè ($set).
 * Các fields không có trong đây sẽ được $set (ghi đè bằng giá trị mới nhất).
 */
export const INC_FIELDS: Record<MetricType, string[]> = {
  [MetricType.PLATFORM]: ['sent', 'received', 'rendered', 'failed'],
  [MetricType.DEVICE]: ['received', 'rendered', 'failed'],
  [MetricType.TRANSPORT]: ['count'],
  [MetricType.SDK]: ['count'],
  [MetricType.FAILURE]: ['count'],
  [MetricType.TIMESERIES]: ['value'],
  [MetricType.LATENCY]: [], // Latency là percentiles — không thể cộng dồn
};

/**
 * Sort field mặc định cho query.
 */
export const SORT_FIELDS: Record<MetricType, string> = {
  [MetricType.TIMESERIES]: 'time',
  [MetricType.PLATFORM]: 'intervalFrom',
  [MetricType.DEVICE]: 'intervalFrom',
  [MetricType.TRANSPORT]: 'intervalFrom',
  [MetricType.SDK]: 'intervalFrom',
  [MetricType.FAILURE]: 'intervalFrom',
  [MetricType.LATENCY]: 'intervalFrom',
};
