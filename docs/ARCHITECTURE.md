# DataRefinery — Architecture Document

> Bug report: see [BUGS.md](../BUGS.md)

---

## 1. PROJECT OVERVIEW

**DataRefinery** là NestJS ETL pipeline, pre-aggregate tracking events từ Elasticsearch (`tracking-events-*`) và persist vào 7 MongoDB collections. Đồng thời cung cấp Read API để internal services query từ MongoDB thay vì động ES trực tiếp.

Dữ liệu phục vụ màn hình **"Chỉ số bản overlay"** cho backend.

---

## 2. TECH STACK

| Layer | Technology | Version |
|-------|-----------|---------|
| Framework | NestJS | 11 |
| Task Queue | BullMQ | 5 |
| Database | MongoDB + Mongoose | 9 |
| Search Engine | Elasticsearch | 9 (`@elastic/elasticsearch`) |
| Queue Backend | Redis | 5+ (ioredis) |
| Language | TypeScript | 5.7+ |
| Test | Jest | 30 |

---

## 3. ARCHITECTURE DIAGRAM

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           DataRefinery Application                            │
├─────────────────────────────────────────────────────────────────────────────┤
│  ETL Pipeline                                                Read API         │
│  ────────────                                                ───────         │
│                                                                               │
│  Scheduler (BullMQ upsertJobScheduler)                                       │
│           │                                                                  │
│           │ every 5 minutes                                                  │
│           ▼                                                                  │
│  ┌─────────────────────┐                                                    │
│  │  Processor          │  WorkerHost — route by job.name                    │
│  │  (OverlayMetrics    │  Job: extract-transform-load-metrics               │
│  │   Processor)        │                                                    │
│  └────────┬────────────┘                                                    │
│           │                                                                  │
│           ▼                                                                  │
│  ┌─────────────────────┐     ┌──────────────────────────────────┐          │
│  │  Extractor          │────▶│  Elasticsearch aggregations      │          │
│  │  (ExtractorService  │     │  index: tracking-events-*        │          │
│  │   → TrackingEsServ.)│     │  13 aggregation queries          │          │
│  └────────┬────────────┘     └──────────────────────────────────┘          │
│           │                                                                  │
│           ▼                                                                  │
│  ┌─────────────────────┐                                                    │
│  │  Transformer        │  Map ES aggregations → 7 DTOs                      │
│  │  (TransformerService)│  Tính derived metrics: rate, percentile, funnel   │
│  └────────┬────────────┘                                                    │
│           │                                                                  │
│           ▼                                                                  │
│  ┌─────────────────────┐     ┌──────────────────────────────────┐          │
│  │  Loader             │────▶│  MongoDB                         │◀────────┤
│  │  (LoaderService)    │     │  bulkWrite (upsert with $inc)    │         │
│  └─────────────────────┘     │  7 collections                   │         │
│                              └──────────────────────────────────┘         │
│                                           ▲                                │
│                                           │                                │
│  ┌─────────────────────┐                  │                                │
│  │  Read API           │──────────────────┘                                │
│  │  (MetricsApiController│  GET /metrics/* → Repository.find()             │
│  │   + MetricsApiService)│  InternalApiGuard (x-internal-api-key)         │
│  └─────────────────────┘                                                   │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 4. DATA FLOW DETAIL

### 4.1 ETL Pipeline (per timeline)

```
SchedulerService.onModuleInit()
  └─ queue.upsertJobScheduler('overlay-metrics-every-5min', {every: 5min})
       │
       ▼ (triggers every 5 min)
OverlayMetricsProcessor.process(job)
  ├─ validateJobData(): { timeRangeMinutes, tenantId, matchId, timelineIds }
  ├─ resolveInterval(): tính intervalFrom / intervalTo (hoặc dùng explicit backfill)
  │
  └─ for each timelineId:
       ├─ 1. extractPlatformMetrics()         → transformPlatformMetrics()         → loadPlatformMetrics()
       │                                                                               (1 ES query)
       ├─ 2. extractDeviceBreakdown('browser') → transformDeviceBreakdown()         → loadDeviceBreakdown()
       ├─    extractDeviceBreakdown('os')      → transformDeviceBreakdown()         → loadDeviceBreakdown()
       ├─    extractDeviceBreakdown('deviceClass') → transformDeviceBreakdown()     → loadDeviceBreakdown()
       │                                                                               (3 ES queries)
       ├─ 3. extractTransportComparison()      → transformTransportComparison()     → loadTransportComparison()
       │                                                                               (1 ES query)
       ├─ 4. extractSdkVersions()              → transformSdkVersions()             → loadSdkVersions()
       │                                                                               (1 ES query)
       ├─ 5. extractFailures()                 → transformFailures()                → loadFailures()
       │                                                                               (1 ES query)
       ├─ 6. extractLatency()                  → transformLatency()                 → loadLatency()
       │                                                                               (1 ES query)
       └─ 7. extractTimeseries(metric, '5m')   → transformTimeseries()              → loadTimeseries()
             (x5 metrics: sent, received, rendered, failed, avgRenderMs)              (5 ES queries)
```

**Tổng cộng: 13 ES queries mỗi timeline mỗi job run.**

### 4.2 Upsert Logic (Repository)

`OverlayMetricsRepository.upsert(type, items)` build `bulkWrite` operations với:

- **Filter**: composite unique key theo `UNIQUE_FIELDS[type]` (luôn bao gồm `tenantId`)
- **$inc**: cộng dồn raw counts (`sent`, `received`, `rendered`, `failed`, `count`, `value`)
- **$set**: ghi đè derived metrics và metadata (`rate`, `percentile`, `platform`, v.v.)
- **$setOnInsert**: chỉ set `createdAt` khi insert mới
- **$currentDate**: luôn refresh `updatedAt`

Điều này cho phép chạy ETL nhiều lần cho cùng `matchId` mà không mất data.

---

## 5. MODULE STRUCTURE

```
src/
├── main.ts                                      # Bootstrap + global ValidationPipe + Swagger
├── app.module.ts                                # ConfigModule, MongooseModule, BullModule, ES core, ETL, API
├── config/
│   ├── app.config.ts                            # NODE_ENV, PORT, ELASTIC_APM_ENVIRONMENT
│   ├── elasticsearch.config.ts                  # ES node, auth, trackingIndex, trackingTimeoutMs
│   ├── mongo.config.ts                          # MONGODB_URI
│   └── redis.config.ts                          # REDIS_HOST, PORT, PASSWORD
├── common/
│   ├── constants/
│   │   └── scheduler.constants.ts               # OVERLAY_METRICS_QUEUE, SCHEDULER_ID, JOB
│   ├── guards/
│   │   └── internal-api.guard.ts                # Server-to-server auth via x-internal-api-key
│   ├── interfaces/
│   │   └── transform-context.interface.ts       # TransformContext {timelineId, matchId, tenantId, intervalFrom, intervalTo}
│   ├── modules/
│   │   └── elasticsearch-core.module.ts         # @Global() ElasticsearchModule.registerAsync
│   └── repositories/
│       └── base.repository.ts                   # Abstract generic BaseRepository<T> (findById, findOne, findAll, create, update, delete, bulkWrite)
├── domain/
│   ├── enums/
│   │   └── metric-type.enum.ts                  # MetricType: PLATFORM, DEVICE, TRANSPORT, SDK, FAILURE, TIMESERIES, LATENCY
│   ├── dto/
│   │   ├── index.ts                             # Barrel export
│   │   ├── platform-metric.dto.ts
│   │   ├── device-breakdown.dto.ts
│   │   ├── transport-comparison.dto.ts
│   │   ├── sdk-version.dto.ts
│   │   ├── failure-analysis.dto.ts
│   │   ├── latency-percentile.dto.ts
│   │   └── timeseries-point.dto.ts
│   └── schemas/
│       ├── index.ts                             # Barrel export
│       ├── overlay-metrics-platform.schema.ts
│       ├── overlay-metrics-device.schema.ts
│       ├── overlay-metrics-transport.schema.ts
│       ├── overlay-metrics-sdk.schema.ts
│       ├── overlay-metrics-failure.schema.ts
│       ├── overlay-metrics-timeseries.schema.ts
│       └── overlay-metrics-latency.schema.ts
├── infrastructure/
│   └── persistence/
│       ├── persistence.module.ts                # MongooseModule.forFeature 7 schemas
│       ├── metric-meta.ts                       # UNIQUE_FIELDS, INC_FIELDS, SORT_FIELDS per MetricType
│       └── overlay-metrics.repository.ts        # Repository pattern: upsert() + find() via Record<MetricType, Model>
└── modules/
    ├── overlay-metrics-etl/
    │   ├── etl.module.ts
    │   ├── extractor/
    │   │   ├── extractor.module.ts
    │   │   ├── extractor.service.ts             # 7 delegate methods → TrackingEsService
    │   │   ├── dto/
    │   │   │   └── tracking-agg-query.dto.ts    # timelineIds, tenantId, from, to, platform, mediaContentId
    │   │   └── elasticsearch/
    │   │       ├── tracking-es.service.ts       # 7 ES aggregation queries + buildBaseQuery()
    │   │       └── types/
    │   │           └── tracking-es-aggs.types.ts
    │   ├── transformer/
    │   │   ├── transformer.module.ts
    │   │   ├── transformer.service.ts           # 7 transform methods + normalizeValue + calculateRate
    │   │   └── transformer.service.spec.ts
    │   ├── loader/
    │   │   ├── loader.module.ts
    │   │   └── loader.service.ts                # 7 load methods → Repository.upsert()
    │   └── scheduler/
    │       ├── scheduler.module.ts              # BullModule.registerQueue + providers
    │       ├── scheduler.service.ts             # upsertJobScheduler on module init
    │       └── processors/
    │           └── overlay-metrics.processor.ts # WorkerHost, 7-step ETL job
    └── overlay-metrics-api/
        ├── api.module.ts                        # Imports PersistenceModule, providers: [MetricsApiController, MetricsApiService]
        ├── metrics-api.module.ts                # Legacy module (dùng MongooseModule.forFeature trực tiếp)
        ├── metrics-api.controller.ts            # 7 GET endpoints under /metrics + InternalApiGuard
        ├── metrics-api.service.ts               # Build filter + delegate Repository.find()
        └── dto/
            └── metrics-query.dto.ts             # matchId, timelineIds, from, to
```

---

## 6. ELASTICSEARCH AGGREGATION QUERIES

### 6.1 Base Query Filter (`buildBaseQuery`)

Mọi query đều dùng chung base filter:
- `labels.tenant_id = tenantId`
- `labels.environment = ELASTIC_APM_ENVIRONMENT`
- `labels.timeline_id IN timelineIds` (if provided)
- `labels.media_content_id = mediaContentId` (if provided)
- `@timestamp ∈ [from, to]` (if provided)
- `labels.platform = platform` (if provided)

### 6.2 Platform Metrics Query

```
terms(labels.platform) → size:100, missing: 'unknown'
  ├── sent: filter(stage=sent) → sum(numeric_labels.room_size)
  ├── received: filter(stage=received)
  ├── rendered: filter(stage=rendered) → avg(numeric_labels.render_duration_ms)
  └── failed: filter(stage=render-failed)
```

### 6.3 Device Breakdown Query

```
terms(labels.browser|labels.client_os|labels.device_class) → size:50, missing: 'unknown'
  └── by_stage: filters(received, rendered, render-failed)
        └── avg(numeric_labels.render_duration_ms)
```

### 6.4 Transport Comparison Query

```
terms(labels.transport_mode) → size:10, missing: 'unknown'
  └── by_stage: filters(received, rendered)
        ├── avg(numeric_labels.render_duration_ms)
        └── percentiles(numeric_labels.render_duration_ms, [95])
```

### 6.5 SDK Versions Query

```
terms(labels.sdk_version) → size:50, missing: 'unknown'
  └── by_stage: filters(received, rendered)
        └── avg(numeric_labels.render_duration_ms)
```

### 6.6 Failures Query

```
terms(labels.failure_reason) → size:50
  └── terms(labels.failure_step) → size:20
```

### 6.7 Latency Query

```
Top-level aggregations (no bucket splitting):
  ├── receive_latency: percentiles(numeric_labels.receive_latency_ms, [50,75,95,99])
  ├── render_latency: percentiles(numeric_labels.render_duration_ms, [50,75,95,99])
  ├── ack_latency: percentiles(numeric_labels.ack_latency_ms, [50,75,95,99])
  ├── receive_stats: stats(numeric_labels.receive_latency_ms)
  ├── render_stats: stats(numeric_labels.render_duration_ms)
  ├── ack_stats: stats(numeric_labels.ack_latency_ms)
  ├── render_duration: percentiles(numeric_labels.render_duration_ms, [50,95,99])
  └── render_duration_stats: stats(numeric_labels.render_duration_ms)
```

### 6.8 Timeseries Query

```
date_histogram(@timestamp, fixed_interval) → per metric:
  ├── sent: sum(numeric_labels.room_size)
  ├── received: filter(stage=received) → doc_count
  ├── rendered: filter(stage=rendered) → doc_count
  ├── failed: filter(stage=render-failed) → doc_count
  └── avgRenderMs: avg(numeric_labels.render_duration_ms)
```

---

## 7. MONGODB COLLECTIONS & INDEXES

| Collection | Unique Index | Schema Fields |
|-----------|--------------|---------------|
| `overlay_metrics_platform` | `{tenantId, matchId, platform, intervalFrom}` | timelineId, matchId, tenantId, platform, sent, received, rendered, failed, receiveRate, renderRate, failureRate, netSuccessRate, avgRenderMs, intervalFrom/To, processed |
| `overlay_metrics_device` | `{tenantId, matchId, dimension, bucketKey, intervalFrom}` | timelineId, matchId, tenantId, dimension, bucketKey, received, rendered, failed, renderRate, avgRenderMs, intervalFrom/To |
| `overlay_metrics_transport` | `{tenantId, matchId, transportMode, intervalFrom}` | timelineId, matchId, tenantId, transportMode, count, renderRate, avgRenderMs, p95RenderMs, intervalFrom/To |
| `overlay_metrics_sdk` | `{tenantId, matchId, sdkVersion, intervalFrom}` | timelineId, matchId, tenantId, sdkVersion, count, renderRate, avgRenderMs, intervalFrom/To |
| `overlay_metrics_failure` | `{tenantId, matchId, failureReason, failureStep, intervalFrom}` | timelineId, matchId, tenantId, failureReason, failureStep, count, percentOfFailed, intervalFrom/To |
| `overlay_metrics_timeseries` | `{tenantId, matchId, metric, interval, time}` | timelineId, matchId, tenantId, metric, interval, time, value, intervalFrom/To. TTL index: `{intervalFrom: 1, expireAfterSeconds: 7776000}` (90 ngày) |
| `overlay_metrics_latency` | `{tenantId, matchId, intervalFrom}` | timelineId, matchId, tenantId, receive{p50,p75,p95,p99,avg,max}, render{...}, ack{...}, renderDuration{p50,p95,p99,avg}, intervalFrom/To |

**Lưu ý quan trọng:** Unique index bao gồm `tenantId` để đảm bảo data isolation giữa tenants. Data accumulate theo `matchId` (không phải `timelineId`) để gộp data từ nhiều timelines vào cùng 1 record.

---

## 8. REPOSITORY PATTERN

### 8.1 BaseRepository<T>

```typescript
export abstract class BaseRepository<T extends Document> {
  constructor(protected readonly model: Model<T>)

  async findById(id: string): Promise<T | null>
  async findOne(filter: Record<string, any>): Promise<T | null>
  async findAll(filter: Record<string, any> = {}): Promise<T[]>
  async create(data: Partial<T>): Promise<T>
  async update(id: string, data: Record<string, any>): Promise<T | null>
  async delete(id: string): Promise<T | null>
  async bulkWrite(operations: AnyBulkWriteOperation<any>[]): Promise<BulkWriteResult>
}
```

### 8.2 OverlayMetricsRepository

Inject 7 Models và dùng `Record<MetricType, Model<any>>` để dispatch:

- `upsert(type, items)` — build `bulkWrite(updateOne + upsert: true)` với `$inc/$set/$setOnInsert/$currentDate`
- `find(type, filter)` — query với sort theo `SORT_FIELDS[type]` (descending)

### 8.3 metric-meta.ts

```typescript
UNIQUE_FIELDS: Record<MetricType, string[]>   // Composite unique key per type
INC_FIELDS:    Record<MetricType, string[]>   // Fields accumulate via $inc
SORT_FIELDS:   Record<MetricType, string>     // Default sort field per type
```

---

## 9. READ API

### 9.1 Authentication

- `InternalApiGuard` kiểm tra header `x-internal-api-key` so sánh với `INTERNAL_API_KEY`
- Tất cả endpoints yêu cầu `x-tenant-id` header

### 9.2 Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/metrics/platform` | Platform metrics (tỷ lệ nhận, render, lỗi) |
| `GET` | `/metrics/device` | Device breakdown (browser/OS/device class) |
| `GET` | `/metrics/transport` | Transport comparison (WebSocket vs Long Polling) |
| `GET` | `/metrics/sdk` | SDK version distribution |
| `GET` | `/metrics/failures` | Failure analysis (lý do × bước lỗi) |
| `GET` | `/metrics/latency` | Latency percentiles (p50/p75/p95/p99) |
| `GET` | `/metrics/timeseries?metric=` | Timeseries data (5m interval) |

Query params (`MetricsQueryDto`):
- `matchId` — filter theo match
- `timelineIds` — filter theo 1 hoặc nhiều timeline
- `from`, `to` — filter theo `intervalFrom` (ISO 8601)
- `metric` (timeseries only) — lọc series cụ thể: `sent`, `received`, `rendered`, `failed`, `avgRenderMs`

---

## 10. CONFIG SYSTEM

Sử dụng `@nestjs/config` với `registerAs` + `forRootAsync`:

```typescript
// Ví dụ: app.config.ts
export default registerAs('app', () => ({
  env: process.env.NODE_ENV || 'development',
  port: parseIntOrDefault(process.env.PORT, 3000),
  elasticApmEnvironment: process.env.ELASTIC_APM_ENVIRONMENT || 'development',
}));
```

Helper `parseIntOrDefault(value, defaultValue)` parse số an toàn, fallback khi `NaN`.

`app.module.ts` wire up:
- `ConfigModule.forRoot({ isGlobal: true, load: [appConfig, mongoConfig, redisConfig, elasticsearchConfig] })`
- `MongooseModule.forRootAsync({ inject: [ConfigService], useFactory: ... })`
- `BullModule.forRootAsync({ inject: [ConfigService], useFactory: ... })`

---

## 11. ENVIRONMENT VARIABLES

| Variable | Default | Description |
|----------|---------|-------------|
| `NODE_ENV` | `development` | Runtime environment |
| `PORT` | `5001` | HTTP server port |
| `REDIS_HOST` | `localhost` | BullMQ Redis host |
| `REDIS_PORT` | `6379` | Redis port |
| `REDIS_PASSWORD` | — | Redis auth |
| `MONGODB_URI` | `mongodb://localhost:27017/datarefinery` | MongoDB connection |
| `ELASTICSEARCH_NODE` | `http://localhost:9200` | ES cluster URL |
| `ELASTICSEARCH_USERNAME` | — | ES auth |
| `ELASTICSEARCH_PASSWORD` | — | ES auth |
| `ELASTICSEARCH_APM_INDEX` | `traces-apm-*` | Legacy APM index |
| `TRACKING_ES_INDEX` | `tracking-events-*` | Tracking index pattern |
| `TRACKING_ES_TIMEOUT_MS` | `10000` | ES request timeout (ms) |
| `ELASTIC_APM_ENVIRONMENT` | `development` | ES environment filter |
| `OVERLAY_METRICS_TENANT_ID` | — | Tenant ID cho scheduler built-in |
| `OVERLAY_METRICS_MATCH_ID` | — | Match ID cho scheduler built-in |

| `INTERNAL_API_KEY` | — | API key cho server-to-server auth |
| `TZ` | `Asia/Ho_Chi_Minh` | Timezone |

---

## 12. JOB SCHEDULE

- **Queue:** `overlay-metrics`
- **Scheduler ID:** `overlay-metrics-every-5min`
- **Job name:** `extract-transform-load-metrics`
- **Frequency:** 5 minutes (`every: 5 * 60 * 1000`)
- **Retry:** 3 attempts, exponential backoff (`delay: 5000ms`)
- **Job data:** `{ timeRangeMinutes: 5, tenantId, matchId, timelineIds }`

Scheduler đọc targets từ DB (`scheduler_targets`, `enabled: true`) và validate tenant qua `TenantCacheService`. Nếu có `OVERLAY_METRICS_TENANT_ID` env var, chỉ chạy targets của tenant đó. Nếu không có target nào, scheduler sẽ không đăng ký job và log warning.

---

## 13. SECURITY

- **InternalApiGuard**: xác thực server-to-server qua `x-internal-api-key` header
- **ValidationPipe**: `whitelist`, `forbidNonWhitelisted`, `transform` — reject unknown fields
- **Swagger UI**: chỉ bật ở non-production (`env !== 'production'`), path `/api/docs`

---

> Full bug report: [BUGS.md](./BUGS.md)
