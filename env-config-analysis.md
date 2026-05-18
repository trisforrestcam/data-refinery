# Environment & Config Analysis

## Files Read
- `src/config/app.config.ts` (lines 1–17)
- `src/config/mongo.config.ts` (lines 1–5)
- `src/config/elasticsearch.config.ts` (lines 1–21)
- `src/config/kafka.config.ts` (lines 1–22)
- `src/config/index.ts` (lines 1–4)
- `.env.example` (full file)
- `src/common/guards/internal-api.guard.ts` (full file)
- `src/modules/overlay-metrics-etl/scheduler/scheduler-config.service.ts` (lines 30–40)
- `src/modules/overlay-metrics-etl/extractor/elasticsearch/tracking-es.service.ts` (lines 380–450)

---

## Env Var Summary Table

| Env Var | Config File | Default | In `.env.example`? | Notes |
|---------|-------------|---------|-------------------|-------|
| `NODE_ENV` | `app.config.ts` | `development` | ✅ Yes | — |
| `PORT` | `app.config.ts` | `3000` | ✅ Yes (set to `5001`) | — |
| `HOST` | `app.config.ts` | `0.0.0.0` | ✅ Yes | — |
| `ELASTIC_APM_ENVIRONMENT` | `app.config.ts` | `development` | ❌ **No** | Filters ES `labels.environment` |
| `INTERNAL_API_KEY` | `app.config.ts` | `undefined` | ❌ **No** | **Required** for InternalApiGuard |
| `MONGODB_URI` | `mongo.config.ts` | `mongodb://localhost:27017/datarefinery` | ❌ **No** | — |
| `ELASTICSEARCH_NODE` | `elasticsearch.config.ts` | `http://localhost:9200` | ❌ **No** | — |
| `ELASTICSEARCH_USERNAME` | `elasticsearch.config.ts` | `undefined` | ❌ **No** | Optional auth |
| `ELASTICSEARCH_PASSWORD` | `elasticsearch.config.ts` | `undefined` | ❌ **No** | Optional auth |
| `ELASTICSEARCH_APM_INDEX` | `elasticsearch.config.ts` | `traces-apm-*` | ❌ **No** | — |
| `TRACKING_ES_INDEX` | `elasticsearch.config.ts` | `tracking-events-*` | ❌ **No** | — |
| `TRACKING_ES_TIMEOUT_MS` | `elasticsearch.config.ts` | `10000` | ❌ **No** | — |
| `KAFKA_BROKERS` | `kafka.config.ts` | `localhost:9092` | ✅ Yes | — |
| `KAFKA_CLIENT_ID` | `kafka.config.ts` | `data-refinery` | ✅ Yes | — |
| `KAFKA_GROUP_ID` | `kafka.config.ts` | `data-refinery-etl-consumers` | ✅ Yes | — |
| `KAFKA_DLQ_TOPIC` | `kafka.config.ts` | `overlay-metrics.etl.dlq` | ✅ Yes | — |
| `KAFKA_MAX_RETRIES` | `kafka.config.ts` | `3` | ✅ Yes | — |
| `KAFKA_RETRY_DELAY_MS` | `kafka.config.ts` | `5000` | ✅ Yes | — |
| `REDIS_HOST` | **Missing config file** | — | ✅ Yes | No `redis.config.ts` exists |
| `REDIS_PORT` | **Missing config file** | — | ✅ Yes | No `redis.config.ts` exists |
| `REDIS_PASSWORD` | **Missing config file** | — | ✅ Yes | No `redis.config.ts` exists |
| `OVERLAY_METRICS_TENANT_ID` | **Not in any config file** | — | ❌ **No** | Mentioned in TSDoc only; unused in code |

---

## Flagged Mismatch Risks

### 1. `.env.example` Severely Incomplete
`.env.example` only documents App, Redis, and Kafka variables. It is **missing** all Elasticsearch, MongoDB, and security-related env vars. A new developer or deployment pipeline relying solely on `.env.example` will fail to configure:
- `MONGODB_URI`
- `ELASTICSEARCH_NODE`
- `TRACKING_ES_INDEX`
- `INTERNAL_API_KEY`
- `ELASTIC_APM_ENVIRONMENT`

**Risk:** Misconfiguration on new environments; silent fallback to `localhost` for MongoDB and ES may mask deployment issues until runtime.

### 2. `INTERNAL_API_KEY` Has No Default → Hard Failure
`app.config.ts` sets `internalApiKey: process.env.INTERNAL_API_KEY` with **no fallback**.

`InternalApiGuard` (`src/common/guards/internal-api.guard.ts`, lines 22–25):
```typescript
const apiKey = this.config.get<string>('app.internalApiKey');
if (!apiKey) {
  throw new UnauthorizedException('INTERNAL_API_KEY not configured');
}
```

**Risk:** If `INTERNAL_API_KEY` is unset, **all** protected endpoints (`/metrics/*`, `/tenant-management/*`) return `401 Unauthorized`. The app is effectively unreachable for internal services.

### 3. Missing `src/config/redis.config.ts`
The project instructions (AGENTS.md) explicitly list `redis.config.ts` under `src/config/`, and `.env.example` defines `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD`. However, **no such file exists** in the codebase, and `src/config/index.ts` does not export it.

**Risk:** Redis connection settings are defined in `.env` but never loaded into NestJS ConfigService. If BullMQ or another Redis client relies on ConfigService, it will fall back to hardcoded defaults (e.g., `localhost:6379`) instead of env values.

### 4. `OVERLAY_METRICS_TENANT_ID` — Documentation / Code Mismatch
`scheduler-config.service.ts` (line 34) states in TSDoc:
> "Targets được lọc theo OVERLAY_METRICS_TENANT_ID env var (nếu có)…"

However, the actual `getActiveTargets()` method **never reads** `process.env.OVERLAY_METRICS_TENANT_ID` or filters by it.

**Risk:** Operators may set this env var expecting tenant-scoped scheduling, but it will have **no effect**. This is a stale comment / unimplemented feature.

### 5. Redundant Fallback in `tracking-es.service.ts`
`tracking-es.service.ts` (lines 391–394, 397–400) applies its own fallback defaults:
```typescript
private getIndex(): string {
  return (
    this.configService.get<string>('elasticsearch.trackingIndex') ||
    'tracking-events-*'
  );
}
```
These match the config defaults exactly. While safe, this creates **two sources of truth** for the same default value.

### 6. `ELASTIC_APM_ENVIRONMENT` Double Fallback
`app.config.ts` defaults it to `'development'`. `tracking-es.service.ts` (line 431) also passes `'development'` as the second arg to `ConfigService.get()`. This is redundant but harmless.

---

## Architecture Notes

```
.env / .env.example  →  process.env  →  registerAs() configs  →  ConfigService  →  Guards / Services / ES client
```

- All config files use `registerAs()` + `forRootAsync` pattern.
- `parseIntOrDefault` helper is duplicated in `app.config.ts`, `elasticsearch.config.ts`, and `kafka.config.ts`. Could be centralized.
- Config barrel (`src/config/index.ts`) exports: `appConfig`, `mongoConfig`, `kafkaConfig`, `elasticsearchConfig`.

---

## Recommendations

1. **Update `.env.example`** to include all missing variables (`MONGODB_URI`, `ELASTICSEARCH_NODE`, `TRACKING_ES_INDEX`, `INTERNAL_API_KEY`, `ELASTIC_APM_ENVIRONMENT`, `ELASTICSEARCH_APM_INDEX`, `TRACKING_ES_TIMEOUT_MS`).
2. **Create `src/config/redis.config.ts`** (or remove Redis vars from `.env.example` if unused).
3. **Implement or remove** the `OVERLAY_METRICS_TENANT_ID` filtering logic in `SchedulerConfigService`.
4. **Consider adding a default or startup check** for `INTERNAL_API_KEY` so the app fails fast with a clear message if missing.
5. **Centralize `parseIntOrDefault`** in a shared util to avoid duplication.
