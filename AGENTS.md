# DataRefinery — Project Context

## Overview
ETL pipeline NestJS pre-aggregate tracking events từ Elasticsearch (`tracking-events-*`) vào 7 MongoDB collections, phục vụ metrics **"Chỉ số bản overlay"**. Đồng thờ cung cấp Read API để internal services query từ MongoDB thay vì động ES trực tiếp.

## Stack
- **Framework:** NestJS 11 (modular monolith)
- **Task Queue:** BullMQ v5 (`upsertJobScheduler`)
- **Database:** MongoDB (Mongoose 9)
- **Search:** Elasticsearch 9 (`@elastic/elasticsearch`)
- **ES Integration:** `@nestjs/elasticsearch` via `ElasticsearchCoreModule` (`@Global`)
- **Queue Backend:** Redis
- **Config:** `@nestjs/config` (`registerAs` + `forRootAsync`)

## Architecture

### ETL Pipeline
```
Scheduler (BullMQ) → Processor → Extractor (ES agg) → Transformer → Loader → Repository → MongoDB
```
Processor chạy 7 extraction + transform + load tuần tự mỗi 5 phút. Mỗi timeline trong job data được xử lý riêng biệt.

**Số lượng ES queries mỗi timeline:** 13 lần query
- Platform: 1
- Device: 3 (browser, os, deviceClass)
- Transport: 1
- SDK: 1
- Failures: 1
- Latency: 1
- Timeseries: 5 (sent, received, rendered, failed, avgRenderMs)

### Read API
```
Internal Service ──HTTP──▶ Metrics API → InternalApiGuard → MetricsApiService → Repository → MongoDB
```

## Project Structure
```
src/
├── config/                     # registerAs configs: app, mongo, redis, elasticsearch
│   ├── app.config.ts           # env, port, elasticApmEnvironment
│   ├── mongo.config.ts         # MONGODB_URI
│   ├── redis.config.ts         # REDIS_HOST, REDIS_PORT, REDIS_PASSWORD
│   └── elasticsearch.config.ts # ES node, auth, apmIndex, trackingIndex, trackingTimeoutMs
├── common/
│   ├── constants/              # scheduler constants (queue name, scheduler id, job name)
│   ├── guards/                 # InternalApiGuard (server-to-server auth via x-internal-api-key)
│   ├── interfaces/             # TransformContext (timelineId, matchId, tenantId, intervalFrom, intervalTo)
│   ├── modules/                # ElasticsearchCoreModule (@Global)
│   └── repositories/           # BaseRepository<T> abstract class
├── domain/                     # Shared contracts (framework-agnostic)
│   ├── enums/
│   │   └── metric-type.enum.ts # PLATFORM, DEVICE, TRANSPORT, SDK, FAILURE, TIMESERIES, LATENCY
│   ├── schemas/                # 7 overlay_metrics_* schemas + barrel index.ts
│   │   ├── overlay-metrics-platform.schema.ts    # Unique: tenantId+timelineId+platform+intervalFrom
│   │   ├── overlay-metrics-device.schema.ts      # Unique: tenantId+timelineId+dimension+bucketKey+intervalFrom
│   │   ├── overlay-metrics-transport.schema.ts   # Unique: tenantId+timelineId+transportMode+intervalFrom
│   │   ├── overlay-metrics-sdk.schema.ts         # Unique: tenantId+timelineId+sdkVersion+intervalFrom
│   │   ├── overlay-metrics-failure.schema.ts     # Unique: tenantId+timelineId+failureReason+failureStep+intervalFrom
│   │   ├── overlay-metrics-timeseries.schema.ts  # Unique: tenantId+timelineId+metric+interval+time, TTL 90d
│   │   └── overlay-metrics-latency.schema.ts     # Unique: tenantId+timelineId+intervalFrom, nested percentiles
│   └── dto/                    # 7 metric DTOs + barrel index.ts
│       ├── platform-metric.dto.ts
│       ├── device-breakdown.dto.ts
│       ├── transport-comparison.dto.ts
│       ├── sdk-version.dto.ts
│       ├── failure-analysis.dto.ts
│       ├── latency-percentile.dto.ts   # @ValidateNested, @Type, @IsNumber
│       └── timeseries-point.dto.ts
├── infrastructure/
│   └── persistence/
│       ├── persistence.module.ts            # MongooseModule.forFeature(7 schemas)
│       ├── metric-meta.ts                   # UNIQUE_FIELDS, INC_FIELDS, SORT_FIELDS per MetricType
│       └── overlay-metrics.repository.ts    # Repository pattern: upsert(bulkWrite), find(lean)
└── modules/
    ├── overlay-metrics-etl/    # Domain feature: ETL pipeline
    │   ├── etl.module.ts       # Aggregates ExtractorModule, TransformerModule, LoaderModule, SchedulerModule
    │   ├── extractor/
    │   │   ├── extractor.module.ts
    │   │   ├── extractor.service.ts        # Facade: 7 extract* methods delegate to TrackingEsService
    │   │   ├── dto/tracking-agg-query.dto.ts
    │   │   └── elasticsearch/
    │   │       ├── tracking-es.service.ts  # 7 ES agg query builders, flat query (no body wrapper)
    │   │       └── types/tracking-es-aggs.types.ts
    │   ├── transformer/
    │   │   ├── transformer.module.ts
    │   │   ├── transformer.service.ts      # normalizeValue, calculateRate, 7 transform* methods
    │   │   └── transformer.service.spec.ts # 9 test cases
    │   ├── loader/
    │   │   ├── loader.module.ts
    │   │   └── loader.service.ts           # 7 load* methods delegate to OverlayMetricsRepository.upsert()
    │   └── scheduler/
    │       ├── scheduler.module.ts
    │       ├── scheduler.service.ts        # OnModuleInit, upsertJobScheduler every 5min, reads env vars
    │       └── processors/
    │           └── overlay-metrics.processor.ts  # WorkerHost, validateJobData, resolveInterval, processTimeline
    └── overlay-metrics-api/    # Domain feature: Read API
        ├── api.module.ts              # Imports PersistenceModule, provides controller + service
        ├── metrics-api.module.ts      # Alternative: imports MongooseModule.forFeature directly
        ├── metrics-api.controller.ts  # @Controller('metrics'), 7 GET endpoints, @UseGuards(InternalApiGuard)
        ├── metrics-api.service.ts     # buildFilter + delegate to Repository.find()
        └── dto/
            └── metrics-query.dto.ts   # matchId?, timelineIds?, from?, to? (all optional)
```

## Conventions
1. **Config:** `registerAs` + `forRootAsync`, dùng helper `parseIntOrDefault` để parse số an toàn. Không hardcode credentials.
2. **BullMQ:** `upsertJobScheduler`; processor extends `WorkerHost`, route bằng `job.name`. Retry: `attempts: 3`, `backoff: { type: 'exponential', delay: 5000 }`.
3. **Domain Layer:** Schemas + DTOs + enums ở `domain/`, dùng chung bởi ETL và API.
4. **Repository Pattern:** `OverlayMetricsRepository` centralize persistence. Loader và API đều delegate. BaseRepository<T> cung cấp CRUD cơ bản.
5. **MongoDB:** `@Schema({ timestamps: true })` + `@Prop({ required: true })`, persistence qua Repository (không `@InjectModel` trực tiếp trong Loader/API).
6. **Elasticsearch:** Query flat (không `body` wrapper vì ES client v9), aggregation queries trong `TrackingEsService`. `requestTimeout` từ config.
7. **DTOs:** Đặt trong `dto/` của từng module hoặc `domain/dto/` nếu shared; barrel export qua `index.ts`. `latency-percentile.dto.ts` dùng `@ValidateNested` + `@Type` cho nested objects.
8. **Bulk Operations:** Repository dùng `bulkWrite(updateOne + upsert)` với `$inc` (accumulate fields), `$set` (overwrite fields), `$setOnInsert` (createdAt), `$currentDate` (updatedAt) — idempotency.
9. **Validation:** Global `ValidationPipe` trong `main.ts` — `whitelist`, `forbidNonWhitelisted`, `transform`.
10. **Auth:** `InternalApiGuard` kiểm tra `x-internal-api-key` header cho server-to-server calls. Đọc `process.env.INTERNAL_API_KEY` trực tiếp.
11. **Error Handling:** Log + throw để BullMQ retry theo config backoff.
12. **API Endpoints:** 7 GET endpoints dưới `@Controller('metrics')`, nhận `x-tenant-id` header (required) và `MetricsQueryDto` query params.
13. **Tests:** Unit tests cho TransformerService (instantiate trực tiếp, không cần TestModule).
14. **TSDoc:** Viết TSDoc cho class, interface và method có logic phức tạp. **Không dùng `@param` / `@returns`** vì TypeScript đã inference type từ signature. Chỉ mô tả chức năng, behavior đặc biệt, hoặc cấu trúc aggregation bằng ASCII tree. Ngôn ngữ đồng nhất **tiếng Việt**.

## Important Notes
- `.env.example` định nghĩa `TRACKING_ES_INDEX`, `ELASTIC_APM_ENVIRONMENT`, và `INTERNAL_API_KEY`.
- Scheduler cần 3 env vars: `OVERLAY_METRICS_TENANT_ID`, `OVERLAY_METRICS_MATCH_ID`, `OVERLAY_METRICS_TIMELINE_IDS` (comma-separated). Nếu thiếu → log warning, không đăng ký scheduler.
- Processor chạy job `extract-transform-load-metrics` mỗi 5 phút (`every: 300000`).
- ES index pattern: `tracking-events-*`. Có thêm `apmIndex: 'traces-apm-*'` trong config.
- `resolveInterval` logic: ưu tiên explicit `intervalFrom`/`intervalTo` từ job data (hỗ trợ backfill). Nếu không có, tính từ `job.timestamp + delay`, round xuống bội số của intervalMs.
- Loader delegate persistence cho `OverlayMetricsRepository` (không dùng `@InjectModel` inline).
- Global `ValidationPipe` trong `main.ts`.
- Swagger UI ở `/api/docs` (non-production), security scheme `x-tenant-id`.
- `main.ts` lấy port từ `configService.get<number>('app.port')`, fallback `5001`.
- Platform schema có thêm trường `processed` với `@Prop({ default: false })`.
- Timeseries schema có TTL index `expireAfterSeconds: 7776000` (90 ngày) trên `intervalFrom`.
- `metric-meta.ts` dùng `matchId` trong `UNIQUE_FIELDS` để accumulate data từ nhiều timelines (khác với schema unique index dùng `timelineId`).
- `OverlayMetricsRepository` gom 7 models vào `Record<MetricType, Model<any>>` để dispatch động.

---

*Chi tiết schema, DTO definitions, ES aggregation queries:*
- Schemas: `src/domain/schemas/`
- DTOs: `src/domain/dto/`
- ES queries: `src/modules/overlay-metrics-etl/extractor/elasticsearch/tracking-es.service.ts`
- Processor flow: `src/modules/overlay-metrics-etl/scheduler/processors/overlay-metrics.processor.ts`
- Repository: `src/infrastructure/persistence/overlay-metrics.repository.ts`
- Transform logic: `src/modules/overlay-metrics-etl/transformer/transformer.service.ts`
- API controller: `src/modules/overlay-metrics-api/metrics-api.controller.ts`
- Configs: `src/config/`
