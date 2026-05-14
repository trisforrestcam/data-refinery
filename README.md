# DataRefinery

ETL pipeline NestJS pre-aggregate tracking events từ Elasticsearch (`tracking-events-*`) vào 7 MongoDB collections, phục vụ metrics **"Chỉ số bản overlay"**. Đồng thờ cung cấp Read API để `interactive-backend_v2` (và các internal services khác) query từ MongoDB thay vì động ES trực tiếp.

## Tech Stack

| Thành phần | Phiên bản / Package |
|---|---|
| Framework | NestJS 11 |
| Task Queue | Apache Kafka (`kafkajs`) |
| Database | MongoDB + Mongoose 9 |
| Search | Elasticsearch 9 (`@elastic/elasticsearch`) |
| ES Integration | `@nestjs/elasticsearch` (global module) |
| Queue Backend | Apache Kafka |
| Validation | class-validator 0.15+, class-transformer 0.5+ |
| Language | TypeScript 5.7+ |
| Testing | Jest 30 |
| Linting | ESLint 9 + Prettier 3 |

## Architecture

### ETL Pipeline (mỗi giờ)
```
Cron Scheduler (@nestjs/schedule)
  → Kafka Producer
    → Kafka Topic (overlay-metrics.etl.jobs)
      → Kafka Consumer (TimelineProcessor)
        → Extractor (ES aggregations)
          → Transformer (DTOs + derived metrics)
            → Loader → Repository → MongoDB
```

### Read API (on-demand)
```
interactive-backend_v2  ──HTTP──▶  Metrics API
                                     │
                                     ▼
                              InternalApiGuard (x-internal-api-key)
                                     │
                                     ▼
                              Repository → MongoDB
```

## Project Structure

```
src/
├── main.ts                          # Bootstrap, Swagger, global ValidationPipe
├── app.module.ts                    # Wire up Config, Mongoose, Bull, ES, ETL, API
├── config/                          # registerAs configs
├── common/
│   ├── constants/                   # Kafka topic constants
│   ├── guards/
│   │   └── internal-api.guard.ts   # Server-to-server auth
│   ├── interfaces/
│   │   └── transform-context.interface.ts
│   └── modules/
│       └── elasticsearch-core.module.ts
├── domain/                          # Shared contracts (không phụ thuộc framework)
│   ├── enums/
│   │   └── metric-type.enum.ts
│   ├── schemas/                     # 7 MongoDB schemas + barrel
│   └── dto/                         # 7 metric DTOs + barrel
├── infrastructure/
│   └── persistence/
│       ├── persistence.module.ts    # MongooseModule.forFeature
│       ├── metric-meta.ts           # Unique fields + sort config per metric
│       └── overlay-metrics.repository.ts  # Repository pattern: upsert + find
└── modules/
    ├── overlay-metrics-etl/         # Domain feature: ETL pipeline
    │   ├── etl.module.ts
    │   ├── extractor/
    │   ├── transformer/
    │   ├── loader/
    │   └── kafka/
    └── overlay-metrics-api/         # Domain feature: Read API
        ├── api.module.ts
        ├── metrics.controller.ts    # GET /metrics/* (Swagger + InternalApiGuard)
        ├── metrics.service.ts
        └── dto/
            └── metrics-query.dto.ts
```

## 7 Bước ETL

| Bước | Metric | ES Aggregation | Transform | MongoDB Collection |
|---|---|---|---|---|
| 1 | Platform Metrics | `terms` platform + sub-aggs | `PlatformMetricDto` | `overlay_metrics_platform` |
| 2 | Device Breakdown | `terms` dimension (browser/os/deviceClass) | `DeviceBreakdownDto` × 3 | `overlay_metrics_device` |
| 3 | Transport Comparison | `terms` transport_mode | `TransportComparisonDto` | `overlay_metrics_transport` |
| 4 | SDK Versions | `terms` sdk_version | `SdkVersionDto` | `overlay_metrics_sdk` |
| 5 | Failures | `terms` failure_reason → failure_step | `FailureAnalysisDto` | `overlay_metrics_failure` |
| 6 | Latency | percentiles + stats | `LatencyPercentileDto` | `overlay_metrics_latency` |
| 7 | Timeseries | `date_histogram` 5m | `TimeseriesPointDto` × 5 | `overlay_metrics_timeseries` |

## Environment Variables

```env
# App
NODE_ENV=development
PORT=5001

# Kafka
KAFKA_BROKERS=localhost:9092
KAFKA_CLIENT_ID=data-refinery
KAFKA_GROUP_ID=data-refinery-etl-consumers
KAFKA_DLQ_TOPIC=overlay-metrics.etl.dlq
KAFKA_MAX_RETRIES=3
KAFKA_RETRY_DELAY_MS=5000

# MongoDB
MONGODB_URI=mongodb://localhost:27017/datarefinery

# Elasticsearch
ELASTICSEARCH_NODE=http://localhost:9200
ELASTICSEARCH_USERNAME=
ELASTICSEARCH_PASSWORD=
TRACKING_ES_INDEX=tracking-events-*
TRACKING_ES_TIMEOUT_MS=10000

# Scheduler targets (built-in scheduler)
# Optional: limit scheduler to a single tenant. Targets must be configured via API/DB.
OVERLAY_METRICS_TENANT_ID=tenant-001
OVERLAY_METRICS_MATCH_ID=000000000000000000000000

# Server-to-server auth
INTERNAL_API_KEY=change-me-in-production

# App context
ELASTIC_APM_ENVIRONMENT=development
TZ=Asia/Ho_Chi_Minh
```

## Conventions

- **Config:** `registerAs` + `forRootAsync`, không hardcode credentials.
- **Kafka:** Cron `@nestjs/schedule` + raw `kafkajs` consumer với manual commit, retry pause/resume, DLQ.
- **Domain Layer:** Schemas + DTOs + enums ở `domain/`, dùng chung bởi ETL và API.
- **Repository Pattern:** `OverlayMetricsRepository` centralize persistence. Loader và API đều delegate.
- **Elasticsearch:** Query flat (không `body` wrapper vì ES client v9).
- **DTOs:** Barrel export qua `index.ts`.
- **Bulk Operations:** `bulkWrite(updateOne + upsert)` cho idempotency.
- **Validation:** Global `ValidationPipe` — `whitelist`, `forbidNonWhitelisted`, `transform`.
- **Auth:** `InternalApiGuard` kiểm tra `x-internal-api-key` header cho server-to-server calls.
- **Error Handling:** Log + throw để Kafka consumer retry hoặc DLQ.

## Scripts

```bash
npm run build        # Build production
npm run typecheck    # TypeScript --noEmit
npm run start:dev    # Dev mode với watch
npm run test         # Unit tests (Jest)
npm run test:cov     # Coverage
npm run test:e2e     # E2E tests
npm run lint         # ESLint + fix
npm run format       # Prettier
```

## Docker

```bash
docker build -t data-refinery:latest .
docker compose up -d
```

| Property | Value |
|----------|-------|
| Base image | `node:20-alpine` |
| Stages | 2 (builder + production) |
| User | Non-root (`appuser`) |
| Exposed port | 5001 |
| Healthcheck | `wget http://localhost:5001/` mỗi 30s |

## Swagger

```
http://localhost:5001/api/docs
```

Authorize với:
- `x-tenant-id`: `tenant-001`
- `x-internal-api-key`: token từ `INTERNAL_API_KEY`

## Server-to-Server Call

Từ `interactive-backend_v2`:

```typescript
const { data } = await this.httpService
  .get('http://data-refinery:5001/metrics/platform', {
    headers: {
      'x-tenant-id': tenantId,
      'x-internal-api-key': process.env.DATA_REFINERY_API_KEY,
    },
    params: { matchId, timelineIds: [timelineId] },
  })
  .toPromise();
```

## Documentation

- [Architecture Detail](docs/ARCHITECTURE.md) — ETL flow, ES queries, MongoDB indexes
- [BUGS.md](BUGS.md) — Known issues
- [docs/](docs/) — Full documentation folder

## ES Tracking Document Structure

```json
{
  "labels": {
    "timeline_id": "...",
    "tenant_id": "...",
    "environment": "development",
    "stage": "sent|received|rendered|render-failed",
    "platform": "android|ios|web",
    "browser": "...",
    "client_os": "...",
    "device_class": "...",
    "transport_mode": "wsInteractive|longPolling",
    "sdk_version": "v2.1.0",
    "failure_reason": "...",
    "failure_step": "..."
  },
  "numeric_labels": {
    "room_size": 1000,
    "render_duration_ms": 125.5,
    "receive_latency_ms": 20,
    "ack_latency_ms": 5
  },
  "@timestamp": "2024-01-15T10:00:01Z"
}
```
