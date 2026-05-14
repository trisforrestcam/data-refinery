# MongoDB Schemas — Pre-aggregated Overlay Metrics

> Các collection này lưu kết quả đã được ES aggregate sẵn. API backend chỉ đọc, không tính toán.
> Tất cả schema đều có `@Schema({ timestamps: true })` nên tự động sinh thêm `createdAt` và `updatedAt`.

---

## 1. `overlay_metrics_platform`

Lưu metrics tổng hợp theo platform (Tab "Tổng quan"). Đây là schema duy nhất có thêm trường `processed`.

```typescript
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type OverlayMetricsPlatformDocument =
  HydratedDocument<OverlayMetricsPlatform>;

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
  netSuccessRate!: number;

  @Prop({ required: true, type: Number })
  avgRenderMs!: number;

  @Prop({ required: true })
  intervalFrom!: Date;

  @Prop({ required: true })
  intervalTo!: Date;

  @Prop({ default: false })
  processed!: boolean;
}

export const OverlayMetricsPlatformSchema = SchemaFactory.createForClass(
  OverlayMetricsPlatform,
);

OverlayMetricsPlatformSchema.index(
  { tenantId: 1, matchId: 1, platform: 1, intervalFrom: 1 },
  { unique: true },
);
OverlayMetricsPlatformSchema.index({ matchId: 1, intervalFrom: -1 });
OverlayMetricsPlatformSchema.index({ tenantId: 1, intervalFrom: -1 });
```

---

## 2. `overlay_metrics_device`

Lưu device breakdown (Tab "Thiết bị").

```typescript
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type OverlayMetricsDeviceDocument =
  HydratedDocument<OverlayMetricsDevice>;

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

export const OverlayMetricsDeviceSchema =
  SchemaFactory.createForClass(OverlayMetricsDevice);

OverlayMetricsDeviceSchema.index(
  { tenantId: 1, matchId: 1, dimension: 1, bucketKey: 1, intervalFrom: 1 },
  { unique: true },
);
OverlayMetricsDeviceSchema.index({
  matchId: 1,
  dimension: 1,
  intervalFrom: -1,
});
OverlayMetricsDeviceSchema.index({ tenantId: 1, intervalFrom: -1 });
```

---

## 3. `overlay_metrics_transport`

Lưu transport comparison (Tab "Transport").

```typescript
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type OverlayMetricsTransportDocument =
  HydratedDocument<OverlayMetricsTransport>;

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

export const OverlayMetricsTransportSchema = SchemaFactory.createForClass(
  OverlayMetricsTransport,
);

OverlayMetricsTransportSchema.index(
  { tenantId: 1, matchId: 1, transportMode: 1, intervalFrom: 1 },
  { unique: true },
);
OverlayMetricsTransportSchema.index({ matchId: 1, intervalFrom: -1 });
OverlayMetricsTransportSchema.index({ tenantId: 1, intervalFrom: -1 });
```

---

## 4. `overlay_metrics_sdk`

Lưu SDK version breakdown (Tab "SDK").

```typescript
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type OverlayMetricsSdkDocument = HydratedDocument<OverlayMetricsSdk>;

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

export const OverlayMetricsSdkSchema =
  SchemaFactory.createForClass(OverlayMetricsSdk);

OverlayMetricsSdkSchema.index(
  { tenantId: 1, matchId: 1, sdkVersion: 1, intervalFrom: 1 },
  { unique: true },
);
OverlayMetricsSdkSchema.index({ matchId: 1, intervalFrom: -1 });
OverlayMetricsSdkSchema.index({ tenantId: 1, intervalFrom: -1 });
```

---

## 5. `overlay_metrics_failure`

Lưu failure analysis (Tab "Lỗi").

```typescript
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type OverlayMetricsFailureDocument =
  HydratedDocument<OverlayMetricsFailure>;

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

export const OverlayMetricsFailureSchema = SchemaFactory.createForClass(
  OverlayMetricsFailure,
);

OverlayMetricsFailureSchema.index(
  {
    tenantId: 1,
    matchId: 1,
    failureReason: 1,
    failureStep: 1,
    intervalFrom: 1,
  },
  { unique: true },
);
OverlayMetricsFailureSchema.index({ matchId: 1, intervalFrom: -1 });
OverlayMetricsFailureSchema.index({ tenantId: 1, intervalFrom: -1 });
```

---

## 6. `overlay_metrics_timeseries`

Lưu timeseries points (Tab "Thờ gian"). Collection này có **TTL index** để tự động xóa dữ liệu cũ sau 90 ngày.

```typescript
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type OverlayMetricsTimeseriesDocument =
  HydratedDocument<OverlayMetricsTimeseries>;

const TIMESERIES_RETENTION_SECONDS = 90 * 24 * 60 * 60; // 90 days

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

export const OverlayMetricsTimeseriesSchema = SchemaFactory.createForClass(
  OverlayMetricsTimeseries,
);

OverlayMetricsTimeseriesSchema.index(
  { tenantId: 1, matchId: 1, metric: 1, interval: 1, time: 1 },
  { unique: true },
);
OverlayMetricsTimeseriesSchema.index({ matchId: 1, metric: 1, time: -1 });
OverlayMetricsTimeseriesSchema.index({ tenantId: 1, metric: 1, time: -1 });
OverlayMetricsTimeseriesSchema.index(
  { intervalFrom: 1 },
  { expireAfterSeconds: TIMESERIES_RETENTION_SECONDS },
);
```

---

## 7. `overlay_metrics_latency`

Lưu latency percentiles. Schema này sử dụng **nested classes** (`PercentileSet`, `RenderDurationSet`) với `@Schema({ _id: false })`, không có trường `metricType` hay object `percentiles`/`stats` dạng flat.

```typescript
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

@Schema({ _id: false })
class PercentileSet {
  @Prop({ required: true, type: Number })
  p50!: number;

  @Prop({ required: true, type: Number })
  p75!: number;

  @Prop({ required: true, type: Number })
  p95!: number;

  @Prop({ required: true, type: Number })
  p99!: number;

  @Prop({ required: true, type: Number })
  avg!: number;

  @Prop({ required: true, type: Number })
  max!: number;
}

@Schema({ _id: false })
class RenderDurationSet {
  @Prop({ required: true, type: Number })
  p50!: number;

  @Prop({ required: true, type: Number })
  p95!: number;

  @Prop({ required: true, type: Number })
  p99!: number;

  @Prop({ required: true, type: Number })
  avg!: number;
}

export type OverlayMetricsLatencyDocument =
  HydratedDocument<OverlayMetricsLatency>;

@Schema({ timestamps: true })
export class OverlayMetricsLatency {
  @Prop({ required: true })
  timelineId!: string;

  @Prop({ required: true })
  matchId!: string;

  @Prop({ required: true })
  tenantId!: string;

  @Prop({ type: PercentileSet, required: true })
  receive!: PercentileSet;

  @Prop({ type: PercentileSet, required: true })
  render!: PercentileSet;

  @Prop({ type: PercentileSet, required: true })
  ack!: PercentileSet;

  @Prop({ type: RenderDurationSet, required: true })
  renderDuration!: RenderDurationSet;

  @Prop({ required: true })
  intervalFrom!: Date;

  @Prop({ required: true })
  intervalTo!: Date;
}

export const OverlayMetricsLatencySchema = SchemaFactory.createForClass(
  OverlayMetricsLatency,
);

OverlayMetricsLatencySchema.index(
  { tenantId: 1, matchId: 1, intervalFrom: 1 },
  { unique: true },
);
OverlayMetricsLatencySchema.index({ matchId: 1, intervalFrom: -1 });
OverlayMetricsLatencySchema.index({ tenantId: 1, intervalFrom: -1 });
```

---

## Tóm tắt Index Strategy

| Collection | Unique Index | Secondary Indexes |
|-----------|--------------|-------------------|
| `overlay_metrics_platform` | `{ tenantId, matchId, platform, intervalFrom }` | `{ matchId, intervalFrom: -1 }`, `{ tenantId, intervalFrom: -1 }` |
| `overlay_metrics_device` | `{ tenantId, matchId, dimension, bucketKey, intervalFrom }` | `{ matchId, dimension, intervalFrom: -1 }`, `{ tenantId, intervalFrom: -1 }` |
| `overlay_metrics_transport` | `{ tenantId, matchId, transportMode, intervalFrom }` | `{ matchId, intervalFrom: -1 }`, `{ tenantId, intervalFrom: -1 }` |
| `overlay_metrics_sdk` | `{ tenantId, matchId, sdkVersion, intervalFrom }` | `{ matchId, intervalFrom: -1 }`, `{ tenantId, intervalFrom: -1 }` |
| `overlay_metrics_failure` | `{ tenantId, matchId, failureReason, failureStep, intervalFrom }` | `{ matchId, intervalFrom: -1 }`, `{ tenantId, intervalFrom: -1 }` |
| `overlay_metrics_timeseries` | `{ tenantId, matchId, metric, interval, time }` | `{ matchId, metric, time: -1 }`, `{ tenantId, metric, time: -1 }`, **TTL**: `{ intervalFrom }` (90 ngày) |
| `overlay_metrics_latency` | `{ tenantId, matchId, intervalFrom }` | `{ matchId, intervalFrom: -1 }`, `{ tenantId, intervalFrom: -1 }` |

### Ghi chú về TTL

- Chỉ `overlay_metrics_timeseries` có TTL index (`expireAfterSeconds: 7776000` = 90 ngày) để tự động dọn dữ liệu cũ.
- Các collection còn lại không có TTL — dữ liệu được giữ vĩnh viễn hoặc xóa thủ công theo nhu cầu.
