# MongoDB Schemas — Pre-aggregated Overlay Metrics

> Các collection này lưu kết quả đã được ES aggregate sẵn. API backend chỉ đọc, không tính toán.

---

## 1. `overlay_metrics_platform`

Lưu metrics tổng hợp theo platform (Tab "Tổng quan").

```typescript
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type OverlayMetricsPlatformDocument = HydratedDocument<OverlayMetricsPlatform>;

@Schema({ timestamps: true })
export class OverlayMetricsPlatform {
  @Prop({ required: true })
  timelineId!: string;

  @Prop({ required: true })
  matchId!: string;

  @Prop({ required: true })
  tenantId!: string;

  @Prop({ required: true })
  platform!: string; // android | ios | web | unknown

  @Prop({ required: true, type: Number })
  sent!: number;

  @Prop({ required: true, type: Number })
  received!: number;

  @Prop({ required: true, type: Number })
  rendered!: number;

  @Prop({ required: true, type: Number })
  failed!: number;

  @Prop({ required: true, type: Number })
  receiveRate!: number; // 0–100

  @Prop({ required: true, type: Number })
  renderRate!: number; // 0–100

  @Prop({ required: true, type: Number })
  failureRate!: number; // 0–100

  @Prop({ required: true, type: Number })
  avgRenderMs!: number;

  @Prop({ required: true })
  intervalFrom!: Date;

  @Prop({ required: true })
  intervalTo!: Date;

  @Prop({ default: false })
  processed!: boolean;
}

export const OverlayMetricsPlatformSchema = SchemaFactory.createForClass(OverlayMetricsPlatform);

OverlayMetricsPlatformSchema.index({ timelineId: 1, platform: 1, intervalFrom: 1 }, { unique: true });
OverlayMetricsPlatformSchema.index({ matchId: 1, intervalFrom: -1 });
OverlayMetricsPlatformSchema.index({ tenantId: 1, intervalFrom: -1 });
```

---

## 2. `overlay_metrics_device`

Lưu device breakdown (Tab "Thiết bị").

```typescript
@Schema({ timestamps: true })
export class OverlayMetricsDevice {
  @Prop({ required: true })
  timelineId!: string;

  @Prop({ required: true })
  matchId!: string;

  @Prop({ required: true })
  tenantId!: string;

  @Prop({ required: true })
  dimension!: string; // browser | os | deviceClass

  @Prop({ required: true })
  bucketKey!: string; // Chrome | Android | mobile

  @Prop({ required: true, type: Number })
  received!: number;

  @Prop({ required: true, type: Number })
  rendered!: number;

  @Prop({ required: true, type: Number })
  failed!: number;

  @Prop({ required: true, type: Number })
  renderRate!: number;

  @Prop({ required: true, type: Number })
  avgRenderMs!: number;

  @Prop({ required: true })
  intervalFrom!: Date;

  @Prop({ required: true })
  intervalTo!: Date;
}

export const OverlayMetricsDeviceSchema = SchemaFactory.createForClass(OverlayMetricsDevice);
OverlayMetricsDeviceSchema.index({ timelineId: 1, dimension: 1, bucketKey: 1, intervalFrom: 1 }, { unique: true });
OverlayMetricsDeviceSchema.index({ matchId: 1, dimension: 1 });
```

---

## 3. `overlay_metrics_transport`

Lưu transport comparison (Tab "Transport").

```typescript
@Schema({ timestamps: true })
export class OverlayMetricsTransport {
  @Prop({ required: true })
  timelineId!: string;

  @Prop({ required: true })
  matchId!: string;

  @Prop({ required: true })
  tenantId!: string;

  @Prop({ required: true })
  transportMode!: string; // wsInteractive | longPolling | unknown

  @Prop({ required: true, type: Number })
  count!: number;

  @Prop({ required: true, type: Number })
  renderRate!: number;

  @Prop({ required: true, type: Number })
  avgRenderMs!: number;

  @Prop({ required: true, type: Number })
  p95RenderMs!: number;

  @Prop({ required: true })
  intervalFrom!: Date;

  @Prop({ required: true })
  intervalTo!: Date;
}

export const OverlayMetricsTransportSchema = SchemaFactory.createForClass(OverlayMetricsTransport);
OverlayMetricsTransportSchema.index({ timelineId: 1, transportMode: 1, intervalFrom: 1 }, { unique: true });
```

---

## 4. `overlay_metrics_sdk`

Lưu SDK version breakdown (Tab "SDK").

```typescript
@Schema({ timestamps: true })
export class OverlayMetricsSdk {
  @Prop({ required: true })
  timelineId!: string;

  @Prop({ required: true })
  matchId!: string;

  @Prop({ required: true })
  tenantId!: string;

  @Prop({ required: true })
  sdkVersion!: string; // v2.1.0 | v1.1.0 | v1.0.0

  @Prop({ required: true, type: Number })
  count!: number;

  @Prop({ required: true, type: Number })
  renderRate!: number;

  @Prop({ required: true, type: Number })
  avgRenderMs!: number;

  @Prop({ required: true })
  intervalFrom!: Date;

  @Prop({ required: true })
  intervalTo!: Date;
}

export const OverlayMetricsSdkSchema = SchemaFactory.createForClass(OverlayMetricsSdk);
OverlayMetricsSdkSchema.index({ timelineId: 1, sdkVersion: 1, intervalFrom: 1 }, { unique: true });
```

---

## 5. `overlay_metrics_failure`

Lưu failure analysis (Tab "Lỗi").

```typescript
@Schema({ timestamps: true })
export class OverlayMetricsFailure {
  @Prop({ required: true })
  timelineId!: string;

  @Prop({ required: true })
  matchId!: string;

  @Prop({ required: true })
  tenantId!: string;

  @Prop({ required: true })
  failureReason!: string;

  @Prop({ required: true })
  failureStep!: string;

  @Prop({ required: true, type: Number })
  count!: number;

  @Prop({ required: true, type: Number })
  percentOfFailed!: number;

  @Prop({ required: true })
  intervalFrom!: Date;

  @Prop({ required: true })
  intervalTo!: Date;
}

export const OverlayMetricsFailureSchema = SchemaFactory.createForClass(OverlayMetricsFailure);
OverlayMetricsFailureSchema.index({ timelineId: 1, failureReason: 1, failureStep: 1, intervalFrom: 1 }, { unique: true });
```

---

## 6. `overlay_metrics_timeseries`

Lưu timeseries points (Tab "Thờ gian").

```typescript
@Schema({ timestamps: true })
export class OverlayMetricsTimeseries {
  @Prop({ required: true })
  timelineId!: string;

  @Prop({ required: true })
  matchId!: string;

  @Prop({ required: true })
  tenantId!: string;

  @Prop({ required: true })
  metric!: string; // sent | received | rendered | failed | avgRenderMs

  @Prop({ required: true })
  interval!: string; // 1m | 5m | 1h | 1d

  @Prop({ required: true })
  time!: Date;

  @Prop({ required: true, type: Number })
  value!: number;

  @Prop({ required: true })
  intervalFrom!: Date;

  @Prop({ required: true })
  intervalTo!: Date;
}

export const OverlayMetricsTimeseriesSchema = SchemaFactory.createForClass(OverlayMetricsTimeseries);
OverlayMetricsTimeseriesSchema.index({ timelineId: 1, metric: 1, interval: 1, time: 1 }, { unique: true });
OverlayMetricsTimeseriesSchema.index({ matchId: 1, metric: 1, time: -1 });
```

---

## 7. `overlay_metrics_latency`

Lưu latency percentiles.

```typescript
@Schema({ timestamps: true })
export class OverlayMetricsLatency {
  @Prop({ required: true })
  timelineId!: string;

  @Prop({ required: true })
  matchId!: string;

  @Prop({ required: true })
  tenantId!: string;

  @Prop({ required: true })
  metricType!: string; // receive | render | ack | renderDuration

  @Prop({ type: Object })
  percentiles!: {
    p50: number;
    p75: number;
    p95: number;
    p99: number;
  };

  @Prop({ type: Object })
  stats!: {
    avg: number;
    max: number;
    min: number;
  };

  @Prop({ required: true })
  intervalFrom!: Date;

  @Prop({ required: true })
  intervalTo!: Date;
}

export const OverlayMetricsLatencySchema = SchemaFactory.createForClass(OverlayMetricsLatency);
OverlayMetricsLatencySchema.index({ timelineId: 1, metricType: 1, intervalFrom: 1 }, { unique: true });
```

---

## Tóm tắt Index Strategy

| Collection | Unique Index | Query Index |
|-----------|--------------|-------------|
| `overlay_metrics_platform` | `[timelineId, platform, intervalFrom]` | `[matchId, intervalFrom]` |
| `overlay_metrics_device` | `[timelineId, dimension, bucketKey, intervalFrom]` | `[matchId, dimension]` |
| `overlay_metrics_transport` | `[timelineId, transportMode, intervalFrom]` | `[matchId, transportMode]` |
| `overlay_metrics_sdk` | `[timelineId, sdkVersion, intervalFrom]` | `[matchId, sdkVersion]` |
| `overlay_metrics_failure` | `[timelineId, failureReason, failureStep, intervalFrom]` | `[matchId, failureReason]` |
| `overlay_metrics_timeseries` | `[timelineId, metric, interval, time]` | `[matchId, metric, time]` |
| `overlay_metrics_latency` | `[timelineId, metricType, intervalFrom]` | `[matchId, metricType]` |

## TTL (optional)

Nếu cần auto-cleanup data cũ, thêm TTL index trên `intervalTo`:

```typescript
schema.index({ intervalTo: 1 }, { expireAfterSeconds: 7776000 }); // 90 days
```
