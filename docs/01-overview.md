# DataRefinery — ETL Pipeline for Overlay Metrics

## Mục tiêu

Thay vì để **interactive-backend_v2** query trực tiếp Elasticsearch (ES) mỗi lần mở dialog "Chỉ số bản overlay", pipeline này **pre-aggregate** toàn bộ tracking metrics từ ES và persist vào MongoDB. Backend chỉ cần đọc từ MongoDB — nhanh, ổn định, scalable.

## Kiến trúc tổng quan

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   Scheduler     │────▶│    Extractor    │────▶│  Transformer    │────▶│     Loader      │
│  (BullMQ Cron)  │     │  (ES Aggregations)│    │ (Map + Compute) │    │  (MongoDB bulk) │
└─────────────────┘     └─────────────────┘     └─────────────────┘     └─────────────────┘
        │                                                                         │
        │                                                                         ▼
        │                                                                ┌─────────────────┐
        │                                                                │  MongoDB        │
        │                                                                │  (pre-aggregated)│
        │                                                                └─────────────────┘
        │                                                                         │
        │                                                                         ▼
        │                                                                ┌─────────────────┐
        └───────────────────────────────────────────────────────────────▶│  API Backend    │
                                                                         │  (read-only)    │
                                                                         └─────────────────┘
```

## Luồng dữ liệu

### 1. Extract — Elasticsearch Aggregations

Không pull raw documents. Dùng **ES aggregations** để tính sẵn:
- `sent`, `received`, `rendered`, `failed` counts
- `receiveRate`, `renderRate`, `failureRate`
- `avgRenderMs`, `p95RenderMs`
- Breakdown theo: `platform`, `device`, `transport`, `sdkVersion`
- Timeseries theo interval

### 2. Transform — Compute & Normalize

- Map ES aggregation buckets sang DTO
- Tính derived metrics (rate, percentile, v.v.)
- Gán `timelineId`, `matchId`, `tenantId`
- Thêm `processedAt`, `intervalFrom`, `intervalTo`

### 3. Load — MongoDB Bulk Write

- `bulkWrite` với `updateOne + upsert` để idempotent
- Index unique trên `[timelineId, matchId, dimension, bucketKey, intervalFrom]`

## Các collection MongoDB

| Collection | Mô tả | Nguồn ES aggregation |
|-----------|-------|---------------------|
| `overlay_metrics_platform` | Metrics tổng hợp theo platform | `terms` on `labels.platform` |
| `overlay_metrics_device` | Device breakdown | `terms` on `labels.browser/os/device_class` |
| `overlay_metrics_transport` | Transport comparison | `terms` on `labels.transport_mode` |
| `overlay_metrics_sdk` | SDK version breakdown | `terms` on `labels.sdk_version` |
| `overlay_metrics_failure` | Failure analysis | `terms` on `labels.failure_reason` + `labels.failure_step` |
| `overlay_metrics_timeseries` | Timeseries bucket theo interval | `date_histogram` on `@timestamp` |
| `overlay_metrics_latency` | Latency percentiles | `percentiles` + `stats` |

## Lợi ích so với query ES trực tiếp

| Tiêu chí | Query ES trực tiếp (cũ) | ETL + MongoDB (mới) |
|----------|------------------------|---------------------|
| Latency API | 200ms–2s tùy data | < 50ms (indexed query) |
| ES load | Mỗi user mở dialog = 1 query ES | Chỉ 1 query ES mỗi 5 phút |
| Consistency | Kết quả thay đổi theo thờ gian query | Snapshot ổn định theo interval |
| Retry/failover | Khó retry, ES down = API lỗi | MongoDB là read replica, robust |
| History | Khó lấy snapshot cũ | Lưu trữ đầy đủ theo interval |

## Các module trong project

```
src/
├── config/
│   ├── app.config.ts
│   ├── mongo.config.ts
│   ├── redis.config.ts
│   └── elasticsearch.config.ts
├── common/
│   ├── constants/
│   ├── guards/
│   │   └── internal-api.guard.ts
│   ├── interfaces/
│   └── modules/
│       └── elasticsearch-core.module.ts
├── domain/
│   ├── enums/
│   │   └── metric-type.enum.ts
│   ├── dto/
│   │   ├── platform-metric.dto.ts
│   │   ├── device-breakdown.dto.ts
│   │   ├── transport-comparison.dto.ts
│   │   ├── sdk-version.dto.ts
│   │   ├── failure-analysis.dto.ts
│   │   ├── latency-percentile.dto.ts
│   │   └── timeseries-point.dto.ts
│   └── schemas/
│       ├── overlay-metrics-platform.schema.ts
│       ├── overlay-metrics-device.schema.ts
│       ├── overlay-metrics-transport.schema.ts
│       ├── overlay-metrics-sdk.schema.ts
│       ├── overlay-metrics-failure.schema.ts
│       ├── overlay-metrics-timeseries.schema.ts
│       └── overlay-metrics-latency.schema.ts
├── infrastructure/
│   └── persistence/
│       ├── persistence.module.ts
│       ├── metric-meta.ts
│       └── overlay-metrics.repository.ts
└── modules/
    ├── overlay-metrics-etl/
    │   ├── etl.module.ts
    │   ├── extractor/
    │   │   ├── extractor.service.ts
    │   │   ├── elasticsearch/
    │   │   │   └── tracking-es.service.ts
    │   │   └── dto/
    │   │       └── tracking-agg-query.dto.ts
    │   ├── transformer/
    │   │   └── transformer.service.ts
    │   ├── loader/
    │   │   └── loader.service.ts
    │   └── scheduler/
    │       ├── scheduler.service.ts
    │       └── processors/
    │           └── overlay-metrics.processor.ts
    └── overlay-metrics-api/
        ├── api.module.ts
        ├── metrics-api.controller.ts
        ├── metrics-api.service.ts
        └── dto/
            └── metrics-query.dto.ts
```

## Timeline thực hiện

1. **Phase 1:** Xây dựng ETL pipeline cho `platform metrics` + `timeseries`
2. **Phase 2:** Thêm `device-breakdown`, `transport-comparison`, `sdk-versions`
3. **Phase 3:** Thêm `latency-percentiles`, `failure-analysis`, `heatmap`
4. **Phase 4:** Refactor backend để chuyển API sang đọc MongoDB
