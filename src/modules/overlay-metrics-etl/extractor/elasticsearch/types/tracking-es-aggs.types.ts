export interface EsAggBucket {
  key: string | number;
  doc_count?: number;
}

export interface EsAggDocCount {
  doc_count?: number;
}

export interface EsAggValue {
  value: number | null;
}

export interface EsAggValues {
  values: Record<string, number | null>;
}

export interface EsAggStats {
  count?: number;
  min?: number;
  max?: number;
  avg?: number;
  sum?: number;
}

export interface EsTermsAgg<TBucket extends EsAggBucket = EsAggBucket> {
  buckets: TBucket[];
}

export interface EsFiltersAgg<TBucket> {
  buckets: Record<string, TBucket>;
}

// Platform metrics
export interface PlatformMetricsSentBucket extends EsAggDocCount {
  room_size_sum: EsAggValue;
}

export interface PlatformMetricsRenderedBucket extends EsAggDocCount {
  avg_render_ms: EsAggValue;
}

export interface PlatformMetricsAggBucket extends EsAggBucket {
  sent: PlatformMetricsSentBucket;
  received: EsAggDocCount;
  rendered: PlatformMetricsRenderedBucket;
  failed: EsAggDocCount;
}

export interface PlatformMetricsAggs {
  platforms?: EsTermsAgg<PlatformMetricsAggBucket>;
}

// Stage buckets (shared for device, transport, sdk)
export interface StageBucket extends EsAggDocCount {
  avg_render_ms?: EsAggValue;
  p95_render_ms?: EsAggValues;
}

export interface StageBuckets {
  buckets: Record<string, StageBucket>;
}

export interface DimensionBucket extends EsAggBucket {
  by_stage: StageBuckets;
}

export interface DeviceBreakdownAggs {
  by_dimension?: EsTermsAgg<DimensionBucket>;
}

export interface TransportComparisonAggBucket extends EsAggBucket {
  by_stage: StageBuckets;
}

export interface TransportComparisonAggs {
  by_transport?: EsTermsAgg<TransportComparisonAggBucket>;
}

export interface SdkVersionAggBucket extends EsAggBucket {
  by_stage: StageBuckets;
}

export interface SdkVersionAggs {
  by_sdk_version?: EsTermsAgg<SdkVersionAggBucket>;
}

// Failures
export type FailureStepBucket = EsAggBucket;

export interface FailureReasonBucket extends EsAggBucket {
  by_step: EsTermsAgg<FailureStepBucket>;
}

export interface FailureAggs {
  by_reason?: EsTermsAgg<FailureReasonBucket>;
}

// Latency
export interface LatencyAggs {
  receive_latency?: EsAggValues;
  render_latency?: EsAggValues;
  ack_latency?: EsAggValues;
  receive_stats?: EsAggStats;
  render_stats?: EsAggStats;
  ack_stats?: EsAggStats;
}

// Timeseries
export interface TimeseriesMetricValue {
  value?: number | null;
  doc_count?: number;
}

export interface TimeseriesBucket extends EsAggBucket {
  key_as_string?: string;
  metric_value: TimeseriesMetricValue;
}

export interface TimeseriesAggs {
  timeseries?: EsTermsAgg<TimeseriesBucket>;
}
