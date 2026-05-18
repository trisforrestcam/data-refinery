# Tenant Infrastructure Analysis

## Files Analyzed
1. `src/common/modules/tenant-cache/tenant-cache.service.ts` (lines 1–86)
2. `src/common/modules/tenant-cache/tenant-cache.module.ts` (lines 1–18)
3. `src/infrastructure/persistence/tenant-connection.manager.ts` (lines 1–101)
4. `src/infrastructure/persistence/tenant-model.factory.ts` (lines 1–78)
5. `src/infrastructure/persistence/overlay-metrics.repository.ts` (lines 1–118)
6. `src/modules/overlay-metrics-api/metrics-api.controller.ts` (lines 1–204)
7. `src/modules/overlay-metrics-api/metrics-api.service.ts` (lines 1–164)
8. `src/modules/overlay-metrics-etl/kafka/timeline-processor.service.ts` (lines 1–147)
9. `src/modules/overlay-metrics-etl/scheduler/scheduler-config.service.ts` (lines 1–78)
10. `src/modules/overlay-metrics-etl/loader/loader.service.ts` (lines 1–37)
11. `src/main.ts` (lines 1–40)
12. `src/app.module.ts` (lines 1–29)

---

## 1. How Tenant Is Loaded on Bootstrap

```
AppModule bootstrap
  └─ MongooseModule.forRootAsync()   // Root DB connection (reads MONGODB_URI)
  └─ TenantCacheModule (@Global)
       └─ TenantCacheService.onModuleInit()
            └─ this.connection.collection('tenants').find({ status: 'ACTIVE' })
                 └─ Map<string, Tenant> cache keyed by tenant.name
```

**Entry point:** `src/common/modules/tenant-cache/tenant-cache.service.ts` lines 22–45.

- `TenantCacheService` implements `OnModuleInit`. NestJS invokes `onModuleInit()` during module initialization.
- It queries the **root** MongoDB connection (injected via `@InjectConnection()`) for documents in the `tenants` collection where `status === 'ACTIVE'`.
- Each document is mapped to the `Tenant` interface `{ name, mongoUri, status }` and stored in a private `Map`.
- On success it logs: `Loaded N active tenant(s) into cache: ...`
- **If the query fails**, it logs an error and **re-throws** the exception (line 43–45). This causes the application bootstrap to crash hard — there is no retry, fallback, or graceful degradation.

---

## 2. What Happens on Tenant Cache Miss

### 2.1 API Read Path
`MetricsApiController` extracts `tenantId` from the `x-tenant-id` header using `@Headers('x-tenant-id')` and passes it directly to `MetricsApiService` → `OverlayMetricsRepository` → `TenantModelFactory` → `TenantConnectionManager`.

**Code trace:**
- `TenantConnectionManager.getConnection(tenantId)` (line 40) calls `this.tenantCache.get(tenantId)`.
- If `tenantId` is missing/unknown → `tenant` is `undefined`.
- `createConnection(tenantId)` throws: **`Error('Tenant not found: ${tenantId}')`** (line 67).
- This bubbles up as an unhandled 500 Internal Server Error to the caller.

**Observations:**
- There is **no validation** in `MetricsApiController` that `x-tenant-id` header is present or non-empty. A missing header results in `tenantId === undefined` and the error message becomes `Tenant not found: undefined`.
- There is **no guard or interceptor** to normalize or validate the tenant before service delegation.

### 2.2 ETL Write Path
`TimelineProcessorService` validates `tenantId` exists as a string in the Kafka payload (`validatePayload`, line 93), but it does **not** verify the tenant exists in `TenantCacheService`.

- If the payload contains an invalid `tenantId`, `TenantConnectionManager.createConnection()` throws during pipeline execution.
- The error is caught by `Promise.all` in `executeTimelinePipeline` (line 141), logged, aggregated into `failedPipelines`, and finally a composite error is thrown.
- `KafkaConsumerService.handleMessage()` catches this, increments retry count, and republishes (up to `maxRetries`). After max retries it sends to DLQ.
- **Behavior:** Not silent, but the retry loop wastes Kafka throughput on a permanently invalid tenantId.

### 2.3 Scheduler Config Path
`SchedulerConfigService.getActiveTargets()` (line 37) is the **only** place that handles cache misses gracefully:

```typescript
targets = targets.filter((t) => {
  if (!this.tenantCache.has(t.tenantId)) {
    this.logger.warn(`Tenant ${t.tenantId} not found in cache, skipping target for match ${t.matchId}`);
    return false;
  }
  return true;
});
```

Invalid tenants are filtered out with a warning. This prevents the cron from producing unprocessable messages.

---

## 3. What Happens on MongoDB Connection Failure

### 3.1 Root DB Failure (Tenant Bootstrap)
If the root MongoDB (configured by `MONGODB_URI`) is unreachable during bootstrap:
- `TenantCacheService.onModuleInit()` throws.
- NestJS catches the lifecycle hook error and prevents the application from starting.
- **Risk:** A transient root DB blip causes a total service outage. There is no retry or "start with empty cache" mode.

### 3.2 Per-Tenant DB Failure
`TenantConnectionManager.createConnection()` (line 61–73):

```typescript
private createConnection(tenantId: string): Connection {
  const tenant = this.tenantCache.get(tenantId);
  if (!tenant) {
    throw new Error(`Tenant not found: ${tenantId}`);
  }

  const connection = createConnection(tenant.mongoUri, {
    maxPoolSize: 10,
  });

  this.connections.set(tenantId, connection);
  return connection;
}
```

**Critical issue:** `createConnection()` in Mongoose returns immediately; it does **not** block until the connection is established. The code does **not** call `await connection.asPromise()` or check `connection.readyState`.

**Consequences:**
- An invalid `mongoUri`, network partition, or down tenant DB will still create a `Connection` object and cache it.
- The first actual database operation (e.g., `model.bulkWrite()` in `OverlayMetricsRepository` or `model.find().lean().exec()`) will fail with a connection error.
- For the **ETL pipeline**, this means the Kafka consumer will retry the same message, but because the bad connection is already cached in `TenantConnectionManager.connections`, every retry will reuse the broken connection and fail again until DLQ.
- For the **API**, the first request for that tenant will fail with 500. Subsequent requests will also reuse the cached dead connection.

**Missing:** Connection health check, `asPromise()`, error event handler, or eviction of failed connections from the cache.

---

## 4. Silent Failures & Missing Error Handling

### Issue 1: `TenantCacheService.refresh()` is not atomic
**File:** `src/common/modules/tenant-cache/tenant-cache.service.ts` (lines 78–82)

```typescript
async refresh(): Promise<void> {
  this.cache.clear();
  await this.onModuleInit();
}
```

- `this.cache.clear()` runs **before** `onModuleInit()`.
- If `onModuleInit()` throws (e.g., root DB temporarily unavailable), the cache is left **empty**.
- All subsequent API requests and ETL jobs for *all* tenants will fail with "Tenant not found" until the app is restarted or an admin successfully calls `refresh-cache` again.
- **Fix:** Populate a temporary Map, swap atomically, or catch and restore.

### Issue 2: No connection readiness validation
**File:** `src/infrastructure/persistence/tenant-connection.manager.ts` (lines 61–73)

- `createConnection(uri, { maxPoolSize: 10 })` does not verify connectivity.
- Should `await connection.asPromise()` before caching, or handle `connection.on('error', ...)` to evict dead connections.

### Issue 3: Missing `x-tenant-id` validation in API layer
**File:** `src/modules/overlay-metrics-api/metrics-api.controller.ts` (passim)

- Every endpoint accepts `@Headers('x-tenant-id') tenantId: string` but there is no `@Header` validation or guard enforcing its presence.
- NestJS leaves the parameter as `undefined` if the header is missing, leading to the unhelpful error `Tenant not found: undefined`.
- **Fix:** Add a `TenantIdGuard` or use `@Header('x-tenant-id')` with a ValidationPipe, or at least assert `if (!tenantId) throw new BadRequestException(...)` in the controller or service.

### Issue 4: Dead code with misleading error path
**File:** `src/infrastructure/persistence/tenant-connection.manager.ts` (lines 82–91)

```typescript
getModel<T>(tenantId: string, name: string, schema: any): Model<T> {
  const connection = this.connections.get(tenantId);
  if (!connection) {
    throw new Error(`Connection not found for tenant: ${tenantId}`);
  }
  return connection.model<T>(name, schema);
}
```

- This method is **never called** by `TenantModelFactory` or any other analyzed file. `TenantModelFactory.getModelByType()` calls `getConnection()` then `conn.model()` directly.
- If it were used, the error message is misleading: the issue is usually that the tenant does not exist in cache, not that the connection was never created.

### Issue 5: Kafka retry on invalid tenant wastes resources
**File:** `src/modules/overlay-metrics-etl/kafka/kafka-consumer.service.ts` (lines 75–110)

- If a message has an invalid `tenantId`, the failure is caught and retried up to `maxRetries` (default 3) with exponential backoff.
- Because `TenantConnectionManager` caches the connection by `tenantId`, and the failure originates from cache miss (not a transient DB error), retries are guaranteed to fail.
- The message eventually goes to DLQ, but 3 retries × backoff waste queue capacity and delay DLQ visibility.
- **Mitigation:** Validate `tenantId` against `TenantCacheService` early in `TimelineProcessorService.processTimeline()` and send directly to DLQ (or skip) instead of retrying.

### Issue 6: No validation that `tenant.mongoUri` is a string
**File:** `src/common/modules/tenant-cache/tenant-cache.service.ts` (lines 32–36)

```typescript
const tenant: Tenant = {
  name: doc.name as string,
  mongoUri: doc.mongoUri as string,
  status: doc.status as string,
};
```

- The code casts fields with `as string`. If a document in the `tenants` collection is missing `mongoUri`, `tenant.mongoUri` becomes `undefined`.
- `createConnection(undefined, { maxPoolSize: 10 })` will fail with a cryptic Mongoose URI error rather than a clear "missing mongoUri" message.
- **Fix:** Validate required fields explicitly before caching.

---

## Architecture Summary

```
Bootstrap:
  Root MongoDB ──▶ TenantCacheService (in-memory Map)
                       │
  Request/Job  ──▶ TenantConnectionManager ──▶ createConnection(tenant.mongoUri)
                       │                              │
                       │                              ▼
                       │                         Cached Connection Map
                       │                              │
                       └──────────────────────────────┘
                                                  │
                                           TenantModelFactory
                                                  │
                                       OverlayMetricsRepository
                                                  │
                                    ┌─────────────┴─────────────┐
                                    ▼                           ▼
                              MetricsApiService            LoaderService
                                    ▼                           ▼
                            HTTP Read API               Kafka ETL Pipeline
```

**Key flows:**
- **Read:** `x-tenant-id` header → Controller → Service → Repository → `TenantModelFactory.getModelByType()` → `TenantConnectionManager.getConnection()` → `tenantCache.get()` → `createConnection()` → MongoDB.
- **Write:** Kafka message → `TimelineProcessorService` → Pipelines → `LoaderService` → Repository → same chain as Read.

---

## Start Here

If you need to fix these issues, open **`src/infrastructure/persistence/tenant-connection.manager.ts`** first.

**Why:** It is the central bottleneck where cache miss and connection failure intersect. Adding `await connection.asPromise()`, connection-error eviction, and a health check here will improve resilience for both the API and ETL paths.

Next, open **`src/common/modules/tenant-cache/tenant-cache.service.ts`** to make `refresh()` atomic and add field validation.
