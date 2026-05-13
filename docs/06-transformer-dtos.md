# Transformer DTOs — MongoDB Document Shapes

> Các DTO này định nghĩa shape của documents sau khi Transformer xử lý ES aggregations. Đây là interface contract giữa Transformer và Loader.

---

## PlatformMetricDto

```typescript
export class PlatformMetricDto {
  timelineId!: string;
  matchId!: string;
  tenantId!: string;
  platform!: string;           // android | ios | web | unknown
  sent!: number;               // sum(numeric_labels.room_size)
  received!: number;           // count(stage=received)
  rendered!: number;           // count(stage=rendered)
  failed!: number;             // count(stage=render-failed)
  receiveRate!: number;        // received / sent * 100
  renderRate!: number;         // rendered / sent * 100
  failureRate!: number;        // failed / received * 100
  avgRenderMs!: number;        // avg(render_duration_ms)
  intervalFrom!: Date;
  intervalTo!: Date;
}
```

---

## DeviceBreakdownDto

```typescript
export class DeviceBreakdownDto {
  timelineId!: string;
  matchId!: string;
  tenantId!: string;
  dimension!: string;          // browser | os | deviceClass
  bucketKey!: string;          // Chrome | Android | mobile
  received!: number;
  rendered!: number;
  failed!: number;
  renderRate!: number;         // rendered / received * 100
  avgRenderMs!: number;
  intervalFrom!: Date;
  intervalTo!: Date;
}
```

---

## TransportComparisonDto

```typescript
export class TransportComparisonDto {
  timelineId!: string;
  matchId!: string;
  tenantId!: string;
  transportMode!: string;      // wsInteractive | longPolling | unknown
  count!: number;              // received + rendered
  renderRate!: number;         // rendered / received * 100
  avgRenderMs!: number;
  p95RenderMs!: number;
  intervalFrom!: Date;
  intervalTo!: Date;
}
```

---

## SdkVersionDto

```typescript
export class SdkVersionDto {
  timelineId!: string;
  matchId!: string;
  tenantId!: string;
  sdkVersion!: string;         // v2.1.0 | v1.1.0 | v1.0.0
  count!: number;              // doc_count của bucket
  renderRate!: number;         // rendered / received * 100
  avgRenderMs!: number;
  intervalFrom!: Date;
  intervalTo!: Date;
}
```

---

## FailureAnalysisDto

```typescript
export class FailureAnalysisDto {
  timelineId!: string;
  matchId!: string;
  tenantId!: string;
  failureReason!: string;
  failureStep!: string;
  count!: number;
  percentOfFailed!: number;    // count / totalFailed * 100
  intervalFrom!: Date;
  intervalTo!: Date;
}
```

---

## LatencyPercentileDto

```typescript
export interface PercentileSet {
  p50: number;
  p75: number;
  p95: number;
  p99: number;
  avg: number;
  max: number;
}

export interface RenderDurationSet {
  p50: number;
  p95: number;
  p99: number;
  avg: number;
}

export class LatencyPercentileDto {
  timelineId!: string;
  matchId!: string;
  tenantId!: string;
  receive!: PercentileSet;
  render!: PercentileSet;
  ack!: PercentileSet;
  renderDuration!: RenderDurationSet;
  intervalFrom!: Date;
  intervalTo!: Date;
}
```

---

## TimeseriesPointDto

```typescript
export class TimeseriesPointDto {
  timelineId!: string;
  matchId!: string;
  tenantId!: string;
  metric!: string;             // sent | received | rendered | failed | avgRenderMs
  interval!: string;           // 1m | 5m | 1h | 1d
  time!: Date;                 // key của date_histogram bucket
  value!: number;
  intervalFrom!: Date;
  intervalTo!: Date;
}
```

---

## MatchFunnelDto (Aggregate từ Platform)

```typescript
export interface PerQuestionMetricDto {
  timelineId: string;
  sent: number;
  received: number;
  rendered: number;
  failed: number;
  receiveRate: number;
  renderRate: number;
}

export class MatchFunnelDto {
  matchId!: string;
  sent!: number;
  received!: number;
  rendered!: number;
  failed!: number;
  receiveRate!: number;
  renderRate!: number;
  failureRate!: number;
  netSuccessRate!: number;     // rendered / sent * 100
  questionCount!: number;
  questions!: PerQuestionMetricDto[];
}
```

**Note:** `MatchFunnelDto` không được persist trực tiếp vào MongoDB. Nó được tính bằng cách aggregate từ `overlay_metrics_platform` collection khi API được gọi:

```typescript
// Tính funnel từ platform metrics
const platforms = await this.platformModel.find({ matchId, tenantId }).lean();

const funnel = platforms.reduce((acc, p) => ({
  sent: acc.sent + p.sent,
  received: acc.received + p.received,
  rendered: acc.rendered + p.rendered,
  failed: acc.failed + p.failed,
}), { sent: 0, received: 0, rendered: 0, failed: 0 });

// Tính rates
funnel.receiveRate = calculateRate(funnel.received, funnel.sent);
funnel.renderRate = calculateRate(funnel.rendered, funnel.sent);
```
