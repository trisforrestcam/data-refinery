# MongoDB Multi-Tenant Audit Report — data-refinery

**Auditor:** Subagent Review  
**Date:** 2026-05-15  
**Scope:** Tenant connection manager, model factory, repository upsert logic, latency schema, tenant cache, persistence module imports  
**Files inspected:**
- `src/infrastructure/persistence/tenant-connection.manager.ts`
- `src/infrastructure/persistence/tenant-model.factory.ts`
- `src/infrastructure/persistence/overlay-metrics.repository.ts`
- `src/infrastructure/persistence/persistence.module.ts`
- `src/infrastructure/persistence/metric-meta.ts`
- `src/domain/schemas/overlay-metrics-latency.schema.ts`
- `src/common/modules/tenant-cache/tenant-cache.service.ts`
- `src/app.module.ts`
- `src/modules/overlay-metrics-etl/loader/loader.service.ts`
- `src/modules/overlay-metrics-etl/transformer/transformer.service.ts`
- `src/modules/overlay-metrics-etl/kafka/timeline-processor.service.ts`
- `test/use-cases/UC-07-latency-percentile.spec.ts`
- `test/use-cases/UC-12-mongodb-duplicate-key.spec.ts`
- `test/use-cases/UC-13-idempotent-rerun.spec.ts`

---

## 1. CRITICAL — `autoIndex: false` prevents ALL schema indexes on tenant databases

**Severity:** CRITICAL  
**File:** `src/infrastructure/persistence/tenant-connection.manager.ts` **L41**  
**Impact:** Data integrity violations, duplicate documents, collection-scan queries, silent loss of unique constraints.

### Evidence
```typescript
const connection = createConnection(tenant.mongoUri, {
  maxPoolSize: 10,
  autoIndex: false,   // ← L41
});
```

`TenantConnectionManager.getConnection()` creates every per-tenant connection with `autoIndex: false`. `TenantModelFactory.getModelByType()` then registers schemas on those connections via `conn.model(name, schema)`. Mongoose will **never** auto-create any index defined in the schema files for tenant databases.

The following indexes are defined but **will never be created on tenant DBs**:

| Collection | Index | Type |
|---|---|---|
| `overlaymetricslatencies` | `{ tenantId: 1, matchId: 1, intervalFrom: 1 }` | **unique** |
| `overlaymetricslatencies` | `{ matchId: 1, intervalFrom: -1 }` | compound |
| `overlaymetricslatencies` | `{ tenantId: 1, intervalFrom: -1 }` | compound |
| `overlaymetricsplatforms` | `{ tenantId: 1, matchId: 1, platform: 1, intervalFrom: 1 }` | **unique** |
| `overlaymetricstimeseries` | `{ tenantId: 1, matchId: 1, metric: 1, interval: 1, time: 1 }` | **unique** |
| `overlaymetricstimeseries` | `{ intervalFrom: 1 }` | TTL (90 days) |
| … (all remaining schemas) | … | … |

### Consequences
1. **Duplicate data under concurrency:** Without the unique index, concurrent `bulkWrite(updateOne + upsert)` operations for the same filter can both result in `insert` instead of one `update`, producing duplicate documents (MongoDB upsert race condition).
2. **No TTL eviction on timeseries:** The `expireAfterSeconds: 7776000` TTL index on `overlaymetricstimeseries` will never be created. Timeseries data will accumulate indefinitely.
3. **Read API performance degradation:** All `Repository.find()` queries will perform collection scans instead of indexed lookups.
4. **Tests pass for the wrong reason:** `UC-12-mongodb-duplicate-key.spec.ts` mocks `TenantModelFactory` and asserts on the mock; the real runtime behavior will **not** throw `E11000` because the unique indexes simply do not exist.

### Recommendation
Either:
- **Option A (preferred):** Remove `autoIndex: false` from `createConnection()` and let Mongoose build indexes on first model registration. If index builds must be non-blocking, set `autoIndex: true` and accept the one-time build cost on first connection.
- **Option B:** Keep `autoIndex: false` but add an explicit `connection.syncIndexes()` or `model.createIndexes()` step after `conn.model()` registration in `TenantModelFactory`, wrapped in error-handling so a single bad index doesn't crash the app.
- **Option C:** Keep `autoIndex: false` and run a one-time migration / index-setup script per tenant database, then remove `autoIndex: false`.

> **Do NOT deploy to production without resolving this.** The idempotency guarantee of the ETL pipeline depends entirely on these unique indexes.

---

## 2. HIGH — Race condition in `TenantConnectionManager.getConnection()` causes connection leaks

**Severity:** HIGH  
**File:** `src/infrastructure/persistence/tenant-connection.manager.ts` **L35–48**  
**Impact:** Orphaned MongoDB connection pools; potential socket exhaustion under load.

### Evidence
```typescript
async getConnection(tenantId: string): Promise<Connection> {
  const cached = this.connections.get(tenantId);
  if (cached) {
    return cached;
  }

  const tenant = this.tenantCache.get(tenantId);
  if (!tenant) {
    throw new Error(`Tenant not found: ${tenantId}`);
  }

  const connection = createConnection(tenant.mongoUri, {
    maxPoolSize: 10,
    autoIndex: false,
  });

  this.connections.set(tenantId, connection);   // ← L47
  return connection;
}
```

There is **no synchronization** between the cache-miss check (L35) and the cache write (L47). Under concurrent requests for the same tenant (e.g., Kafka consumer processing multiple timelines for the same tenant):

```
Thread A: connections.get(t) → undefined
Thread B: connections.get(t) → undefined
Thread A: createConnection() → connA
Thread B: createConnection() → connB
Thread A: connections.set(t, connA)
Thread B: connections.set(t, connB)   // overwrites connA
```

`connA` is now orphaned: it is not referenced by the Map and `onModuleDestroy()` will not close it. With 10 connections per pool, each leak consumes 10 sockets.

### Recommendation
Add a simple async lock or use a double-checked pattern with an in-flight promise map:

```typescript
private readonly pending = new Map<string, Promise<Connection>>();

async getConnection(tenantId: string): Promise<Connection> {
  const cached = this.connections.get(tenantId);
  if (cached) return cached;

  const existing = this.pending.get(tenantId);
  if (existing) return existing;

  const promise = this.createAndCacheConnection(tenantId);
  this.pending.set(tenantId, promise);
  try {
    return await promise;
  } finally {
    this.pending.delete(tenantId);
  }
}
```

---

## 3. MEDIUM — Latency schema `timelineId` is required but excluded from unique key

**Severity:** MEDIUM  
**File:** `src/domain/schemas/overlay-metrics-latency.schema.ts` **L45**  
**File:** `src/infrastructure/persistence/metric-meta.ts` **L20**  
**Impact:** Confusing data semantics; `timelineId` is silently overwritten on every rerun for the same `matchId + intervalFrom`.

### Evidence
- Schema defines `timelineId!: string` with `@Prop({ required: true })`.
- `UNIQUE_FIELDS[LATENCY]` = `['tenantId', 'matchId', 'intervalFrom']` — `timelineId` is omitted intentionally (to accumulate data from multiple timelines into one match record).
- `buildUpsertOps` puts `timelineId` into `$set`, so every rerun overwrites it with the latest timeline ID.

This is **by design** (match-based accumulation rather than timeline-based), but it is a schema/contract mismatch that can confuse operators inspecting the DB.

### Recommendation
Either:
- Remove `timelineId` from the latency schema (since the record represents a match-interval aggregate, not a single timeline), or
- Document explicitly in TSDoc that `timelineId` reflects the *last* timeline that contributed to this match-interval aggregate.

---

## 4. LOW — `$set` redundantly overwrites filter fields in every upsert

**Severity:** LOW  
**File:** `src/infrastructure/persistence/overlay-metrics.repository.ts` **L93–110**  
**Impact:** Slightly larger update payloads; harmless but wasteful.

### Evidence
```typescript
for (const [key, value] of Object.entries(record)) {
  if (value === undefined) continue;
  if (incFields.includes(key) && typeof value === 'number') {
    $inc[key] = value;
  } else {
    $set[key] = value;   // ← also sets tenantId, matchId, intervalFrom, etc.
  }
}
```

Fields that are part of the `filter` (e.g., `tenantId`, `matchId`, `intervalFrom`) are also placed into `$set`. MongoDB allows this, but it is redundant.

### Recommendation
Skip keys that are already in `filter` when building `$set`:

```typescript
} else if (!uniqueFields.includes(key)) {
  $set[key] = value;
}
```

---

## 5. LOW — Collection names may not match team convention

**Severity:** LOW / NOTE  
**File:** `src/infrastructure/persistence/tenant-model.factory.ts` **L45**  
**Impact:** Naming surprise for DBAs; no runtime failure.

### Evidence
Mongoose derives collection names from the model name by default:
- `OverlayMetricsLatency.name` = `"OverlayMetricsLatency"`
- Default Mongoose pluralization → **`overlaymetricslatencies`**

The project context refers to collections as `overlay_metrics_*` (snake_case). If the operations team expects `overlay_metrics_latencies`, they will not find it.

### Recommendation
If snake_case collection names are desired, add explicit `collection` options to the `@Schema()` decorators or override `SchemaFactory.createForClass` behavior. Example:

```typescript
@Schema({ timestamps: true, collection: 'overlay_metrics_latency' })
export class OverlayMetricsLatency { ... }
```

---

## 6. NOTE — `$set` with nested objects for latency works correctly

**Severity:** NONE (correct behavior)  
**File:** `src/infrastructure/persistence/overlay-metrics.repository.ts` **L93–110**  
**File:** `src/domain/schemas/overlay-metrics-latency.schema.ts`

### Evidence
For `MetricType.LATENCY`, `INC_FIELDS` is empty, so all fields go into `$set`. The nested objects (`receive`, `render`, `ack`, `renderDuration`) are plain objects from the DTO. MongoDB `$set` replaces the entire subdocument, which is the **desired** behavior for latency percentiles — we want to overwrite the full percentile set, not merge partial fields.

The subdocument schemas (`PercentileSet`, `RenderDurationSet`) use `@Schema({ _id: false })`, so Mongoose will **not** inject `_id` fields into nested objects. `bulkWrite` casting handles these correctly in Mongoose 9.

**No action required.**

---

## 7. NOTE — `TenantCacheService` and `PersistenceModule` imports are correct

**Severity:** NONE (correct behavior)  
**File:** `src/common/modules/tenant-cache/tenant-cache.service.ts`  
**File:** `src/common/modules/tenant-cache/tenant-cache.module.ts`  
**File:** `src/infrastructure/persistence/persistence.module.ts`  
**File:** `src/app.module.ts`

### Evidence
- `TenantCacheModule` is `@Global()` and provides `TenantCacheService`. ✅
- `TenantCacheService` injects the root connection via `@InjectConnection()` and loads from `collection('tenants')` with filter `{ status: 'ACTIVE' }`. ✅
- `AppModule` imports `MongooseModule.forRootAsync` **before** `TenantCacheModule`, ensuring the root connection is available at bootstrap. ✅
- `PersistenceModule` imports `MongooseModule.forFeature([...])` on the root connection. This is functionally harmless — it creates unused collections on the admin DB but does not affect tenant data isolation. ✅

**No action required.**

---

## 8. NOTE — Collection creation works; indexes do not

**Severity:** NONE (correct behavior, but depends on fixing #1)  
**File:** `src/infrastructure/persistence/tenant-model.factory.ts`

### Evidence
Mongoose 9 defaults `autoCreate: true`. When `TenantModelFactory.getModelByType()` calls `conn.model(name, schema)` and the model is later used in `bulkWrite`, Mongoose lazily creates the collection. **Collections WILL be created on tenant DBs.**

However, because `TenantConnectionManager` passes `autoIndex: false`, **indexes WILL NOT be created** (see Finding #1).

**No action required for collection creation, but indexes must be fixed.**

---

## Summary Matrix

| # | Finding | Severity | File | Line |
|---|---|---|---|---|
| 1 | `autoIndex: false` suppresses all schema indexes on tenant DBs | **CRITICAL** | `tenant-connection.manager.ts` | 41 |
| 2 | Race condition leaks connections under concurrent tenant access | **HIGH** | `tenant-connection.manager.ts` | 35–48 |
| 3 | `timelineId` required but excluded from latency unique key | **MEDIUM** | `overlay-metrics-latency.schema.ts` | 45 |
| 4 | `$set` redundantly overwrites filter fields | **LOW** | `overlay-metrics.repository.ts` | 93–110 |
| 5 | Collection name `overlaymetricslatencies` vs expected snake_case | **LOW** | `tenant-model.factory.ts` | 45 |
| 6 | `$set` nested objects for latency work correctly | — | `overlay-metrics.repository.ts` | 93–110 |
| 7 | `TenantCacheService` / `PersistenceModule` imports correct | — | `tenant-cache.service.ts` | — |
| 8 | Collections created lazily; indexes missing | — | `tenant-model.factory.ts` | 45 |

---

## Recommended Priority Order

1. **Fix `autoIndex: false`** immediately — either remove it or add explicit index creation after model registration. Without this, the entire idempotency and data-integrity model of the ETL pipeline is void.
2. **Fix connection race condition** — add an in-flight promise map to `TenantConnectionManager`.
3. **Clarify `timelineId` semantics** in latency schema or remove the field.
4. **(Optional)** Add explicit `collection` names to schemas if snake_case is preferred.
5. **(Optional)** Optimize `buildUpsertOps` to skip filter fields in `$set`.
