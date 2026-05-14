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

### Multi-Tenant Architecture
```
Request → x-tenant-id header → TenantCacheService (in-memory Map)
                                    ↓
                              TenantConnectionManager (per-tenant MongoDB connection)
                                    ↓
                              TenantModelFactory (dynamic model trên tenant connection)
```
Mỗi tenant có MongoDB URI riêng, connection được cache trong `TenantConnectionManager`. Model được tạo động trên connection của tenant tương ứng. Tenant config load từ collection `tenants` trong DB gốc khi bootstrap, cache trong `TenantCacheService` (@Global).

### ETL Pipeline
```
Scheduler (BullMQ) → Processor → Extractor (ES agg) → Transformer → Loader → Repository → TenantModelFactory → MongoDB (per-tenant)
```
Processor chạy 7 extraction + transform + load tuần tự mỗi 1 giờ. Mỗi timeline trong job data được xử lý riêng biệt. Data được persist vào database riêng của tenant.

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
│   ├── modules/
│   │   ├── elasticsearch-core.module.ts  # @Global ES client module
│   │   └── tenant-cache/                 # @Global tenant config cache
│   │       ├── tenant-cache.module.ts    # @Global, exports TenantCacheService
│   │       └── tenant-cache.service.ts   # Load active tenants từ DB gốc vào Map, refresh()
├── domain/                     # Shared contracts (framework-agnostic)
│   ├── enums/
│   │   ├── metric-type.enum.ts # PLATFORM, DEVICE, TRANSPORT, SDK, FAILURE, TIMESERIES, LATENCY
│   │   └── index.ts            # Barrel export
│   ├── interfaces/
│   │   ├── tenant.interface.ts # Tenant { name, mongoUri, status }
│   │   └── index.ts            # Barrel export
│   ├── schemas/                # 7 overlay_metrics_* schemas + scheduler-target + barrel index.ts
│   │   ├── overlay-metrics-platform.schema.ts    # Unique: tenantId+matchId+platform+intervalFrom
│   │   ├── overlay-metrics-device.schema.ts      # Unique: tenantId+matchId+dimension+bucketKey+intervalFrom
│   │   ├── overlay-metrics-transport.schema.ts   # Unique: tenantId+matchId+transportMode+intervalFrom
│   │   ├── overlay-metrics-sdk.schema.ts         # Unique: tenantId+matchId+sdkVersion+intervalFrom
│   │   ├── overlay-metrics-failure.schema.ts     # Unique: tenantId+matchId+failureReason+failureStep+intervalFrom
│   │   ├── overlay-metrics-timeseries.schema.ts  # Unique: tenantId+matchId+metric+interval+time, TTL 90d
│   │   ├── overlay-metrics-latency.schema.ts     # Unique: tenantId+matchId+intervalFrom, nested percentiles
│   │   └── scheduler-target.schema.ts            # Dynamic scheduler targets per tenant+match
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
│       ├── persistence.module.ts            # MongooseModule.forFeature(7 schemas), provides TenantConnectionManager, TenantModelFactory
│       ├── tenant-connection.manager.ts     # Cache per-tenant MongoDB connections, OnModuleDestroy
│       ├── tenant-model.factory.ts          # Dynamic Mongoose Model per tenant + MetricType, ModelDefinition interface
│       ├── metric-meta.ts                   # UNIQUE_FIELDS, INC_FIELDS, SORT_FIELDS per MetricType
│       └── overlay-metrics.repository.ts    # Repository pattern: upsert(bulkWrite), find(lean), uses TenantModelFactory
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
    │   │   └── loader.service.ts           # 7 load* methods, tenantId param, delegate to OverlayMetricsRepository.upsert()
    │   └── kafka/
    │       ├── kafka.module.ts              # Aggregates ExtractorModule, TransformerModule, LoaderModule, Kafka services
    │       ├── kafka-producer.service.ts    # KafkaJS producer, sendJob / sendToDLQ
    │       ├── kafka-consumer.service.ts    # Raw KafkaJS consumer, manual commit, retry pause/resume, DLQ
    │       ├── job-producer.service.ts      # @Cron('0 * * * *'), reads targets, produces 1 message / timeline
    │       ├── timeline-processor.service.ts # 7-step ETL pipeline per timeline
    │       └── scheduler-config.service.ts  # Quản lý scheduler targets từ MongoDB
    ├── overlay-metrics-api/    # Domain feature: Read API
    │   ├── api.module.ts              # Imports PersistenceModule, provides controller + service
    │   ├── metrics-api.module.ts      # Alternative: imports MongooseModule.forFeature directly
    │   ├── metrics-api.controller.ts  # @Controller('metrics'), 7 GET endpoints, @UseGuards(InternalApiGuard)
    │   ├── metrics-api.service.ts     # buildFilter + delegate to Repository.find()
    │   └── dto/
    │       └── metrics-query.dto.ts   # matchId?, timelineIds?, from?, to? (all optional)
    └── tenant-management/      # System admin: quản lý tenant (reload cache, sync config, v.v.)
        ├── tenant-management.module.ts     # Standalone module, import TenantCacheModule
        ├── tenant-management.controller.ts # @Controller('tenant-management'), POST refresh-cache, @UseGuards(InternalApiGuard)
        └── tenant-management.service.ts    # Delegate to TenantCacheService.refresh(), return status + tenant list
```

## Conventions
1. **Config:** `registerAs` + `forRootAsync`, dùng helper `parseIntOrDefault` để parse số an toàn. Không hardcode credentials.
2. **Kafka:** `@nestjs/schedule` `@Cron('0 * * * *')` trigger `JobProducerService` để produce message vào topic `overlay-metrics.etl.jobs`. `KafkaConsumerService` (raw KafkaJS) xử lý message với `autoCommit: false`, retry qua `consumer.pause/resume` + exponential sleep, DLQ sau `maxRetries`. Config: `KAFKA_MAX_RETRIES=3`, `KAFKA_RETRY_DELAY_MS=5000`.
3. **Domain Layer:** Schemas + DTOs + enums ở `domain/`, dùng chung bởi ETL và API.
4. **Repository Pattern:** `OverlayMetricsRepository` centralize persistence. Loader và API đều delegate. BaseRepository<T> cung cấp CRUD cơ bản.
5. **MongoDB:** `@Schema({ timestamps: true })` + `@Prop({ required: true })`, persistence qua Repository (không `@InjectModel` trực tiếp trong Loader/API). Multi-tenant: `TenantConnectionManager` cache connection, `TenantModelFactory` tạo model động.
6. **Elasticsearch:** Query flat (không `body` wrapper vì ES client v9), aggregation queries trong `TrackingEsService`. `requestTimeout` từ config.
7. **DTOs:** Đặt trong `dto/` của từng module hoặc `domain/dto/` nếu shared; barrel export qua `index.ts`. `latency-percentile.dto.ts` dùng `@ValidateNested` + `@Type` cho nested objects.
8. **Bulk Operations:** Repository dùng `bulkWrite(updateOne + upsert)` với `$inc` (accumulate fields), `$set` (overwrite fields), `$setOnInsert` (createdAt), `$currentDate` (updatedAt) — idempotency.
9. **Validation:** Global `ValidationPipe` trong `main.ts` — `whitelist`, `forbidNonWhitelisted`, `transform`.
10. **Auth:** `InternalApiGuard` kiểm tra `x-internal-api-key` header cho server-to-server calls. Đọc `process.env.INTERNAL_API_KEY` trực tiếp.
11. **Error Handling:** Log + throw để Kafka consumer retry hoặc DLQ.
12. **API Endpoints:** 
    - `overlay-metrics-api`: 7 GET endpoints dưới `@Controller('metrics')`, nhận `x-tenant-id` header (required) và `MetricsQueryDto` query params.
    - `tenant-management`: 1 POST endpoint (`tenant-management/refresh-cache`) dưới `@Controller('tenant-management')`, bảo vệ bởi `InternalApiGuard`. Dùng để reload active tenants từ DB gốc khi có thay đổi cấu hình.
13. **Tests:** Unit tests cho TransformerService (instantiate trực tiếp, không cần TestModule).
14. **TSDoc:** Viết TSDoc cho class, interface và method có logic phức tạp. **Không dùng `@param` / `@returns`** vì TypeScript đã inference type từ signature. Chỉ mô tả chức năng, behavior đặc biệt, hoặc cấu trúc aggregation bằng ASCII tree. Ngôn ngữ đồng nhất **tiếng Việt**.
15. **Method Ordering:** `constructor → public methods → private methods`. Public methods đặt trên, private methods xuống dưới. Helper chỉ dùng trong class nên là `private static`. Không xen kẽ.

## Important Notes
- `.env.example` định nghĩa `TRACKING_ES_INDEX`, `ELASTIC_APM_ENVIRONMENT`, và `INTERNAL_API_KEY`.
- Scheduler cần targets từ DB (`scheduler_targets` collection, `enabled: true`). Targets được validate qua `TenantCacheService` (chỉ giữ tenants đang active). Nếu có `OVERLAY_METRICS_TENANT_ID` env var, chỉ chạy targets của tenant đó. Nếu không có targets nào → log warning, không đăng ký scheduler.
- `JobProducerService.handleCron()` chạy mỗi giờ (`@Cron('0 * * * *')`), produce message vào topic `overlay-metrics.etl.jobs` với `timeRangeMinutes: 60`. Mỗi timeline là 1 message riêng biệt.
- ES index pattern: `tracking-events-*`. Có thêm `apmIndex: 'traces-apm-*'` trong config.
- `resolveInterval` logic: ưu tiên explicit `intervalFrom`/`intervalTo` từ payload (hỗ trợ backfill). Nếu không có, tính từ `new Date()`, round xuống bội số của `timeRangeMinutes`.
- Loader delegate persistence cho `OverlayMetricsRepository` (không dùng `@InjectModel` inline). Mỗi method nhận `tenantId` làm first param.
- Multi-tenant: `TenantConnectionManager` cache MongoDB connection per tenant. `TenantModelFactory` tạo Mongoose Model động trên tenant connection. `TenantCacheService` load active tenants từ DB gốc vào Map khi bootstrap.
- `TenantCacheModule` là `@Global` — mọi module có thể inject `TenantCacheService` mà không cần import.
- Tenant management API: `POST /tenant-management/refresh-cache` — reload tenant cache khi admin thay đổi config, không cần restart app.
- Global `ValidationPipe` trong `main.ts`.
- Swagger UI ở `/api/docs` (non-production), security scheme `x-tenant-id`.
- `main.ts` lấy port từ `configService.get<number>('app.port')`, fallback `3000`. Mongoose debug enabled trong non-production.
- Platform schema có thêm trường `processed` với `@Prop({ default: false })`.
- Timeseries schema có TTL index `expireAfterSeconds: 7776000` (90 ngày) trên `intervalFrom`.
- `metric-meta.ts` dùng `matchId` trong `UNIQUE_FIELDS` để accumulate data từ nhiều timelines (khác với schema unique index dùng `timelineId`).
- `OverlayMetricsRepository` dùng `TenantModelFactory` để lấy model per tenant dynamically, không dùng static `Record<MetricType, Model>`.

---

*Chi tiết schema, DTO definitions, ES aggregation queries:*
- Schemas: `src/domain/schemas/`
- DTOs: `src/domain/dto/`
- Enums: `src/domain/enums/`
- Interfaces: `src/domain/interfaces/`
- ES queries: `src/modules/overlay-metrics-etl/extractor/elasticsearch/tracking-es.service.ts`
- Processor flow: `src/modules/overlay-metrics-etl/kafka/timeline-processor.service.ts`
- Repository: `src/infrastructure/persistence/overlay-metrics.repository.ts`
- Tenant connection: `src/infrastructure/persistence/tenant-connection.manager.ts`
- Tenant model factory: `src/infrastructure/persistence/tenant-model.factory.ts`
- Tenant cache: `src/common/modules/tenant-cache/tenant-cache.service.ts`
- Transform logic: `src/modules/overlay-metrics-etl/transformer/transformer.service.ts`
- API controller: `src/modules/overlay-metrics-api/metrics-api.controller.ts`
- Tenant management: `src/modules/tenant-management/`
- Configs: `src/config/`
