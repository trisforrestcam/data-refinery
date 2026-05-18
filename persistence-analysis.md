# Persistence Layer Analysis

## Scope
Files examined:
- `src/infrastructure/persistence/overlay-metrics.repository.ts`
- `src/infrastructure/persistence/tenant-model.factory.ts`
- `src/infrastructure/persistence/tenant-connection.manager.ts`
- `src/infrastructure/persistence/metric-meta.ts`
- `src/domain/schemas/overlay-metrics-platform.schema.ts`
- `src/domain/schemas/overlay-metrics-device.schema.ts`
- `src/domain/schemas/overlay-metrics-transport.schema.ts`
- `src/domain/schemas/overlay-metrics-sdk.schema.ts`
- `src/domain/schemas/overlay-metrics-failure.schema.ts`
- `src/domain/schemas/overlay-metrics-timeseries.schema.ts`
- `src/domain/schemas/overlay-metrics-latency.schema.ts`
- `src/domain/schemas/scheduler-target.schema.ts`
- `src/modules/overlay-metrics-etl/loader/loader.service.ts`
- `src/modules/overlay-metrics-etl/transformer/transformer.service.ts` (timelineId grep)

---

## 1. How Data Is Persisted

### Entry Point
`OverlayMetricsRepository` (`src/infrastructure/persistence/overlay-metrics.repository.ts`) is the single persistence gateway for both ETL (write) and API (read).

### Write Path: `upsert()`
```typescript
// overlay-metrics.repository.ts (lines 28–40)
async upsert(
  tenantId: string,
  type: MetricType,
  items: Record<string, unknown>[],
): Promise<void> {
  if (!items.length) return;
  const model = await this.tenantModelFactory.getModelByType(tenantId, type);
  const ops = this.buildUpsertOps(items, UNIQUE_FIELDS[type], INC_FIELDS[type]);
  await model.bulkWrite(ops, { ordered: false });
}
```

Each item becomes a `bulkWrite` `updateOne` with:
- **Filter**: composite key from `UNIQUE_FIELDS[type]`
- **`$inc`**: numeric fields listed in `INC_FIELDS[type]` (accumulate raw counts)
- **`$set`**: all other non-undefined fields (overwrite derived metrics and metadata)
- **`$setOnInsert: { createdAt: new Date() }`**
- **`$currentDate: { updatedAt: true }`**
- **`upsert: true`**

### Read Path: `find()`
```typescript
// overlay-metrics.repository.ts (lines 47–56)
async find<T = unknown>(
  tenantId: string,
  type: MetricType,
  filter: Record<string, unknown>,
): Promise<T[]> {
  const model = await this.tenantModelFactory.getModelByType(tenantId, type);
  const sortField = SORT_FIELDS[type];
  return model.find(filter).sort({ [sortField]: -1 }).lean().exec() as Promise<T[]>;
}
```

---

## 2. Unique Fields

### `metric-meta.ts` (`src/infrastructure/persistence/metric-meta.ts`)
Defines three lookup tables per `MetricType`:

| MetricType | UNIQUE_FIELDS (upsert filter) |
|-----------|-------------------------------|
| PLATFORM | `tenantId`, `matchId`, `platform`, `intervalFrom` |
| DEVICE | `tenantId`, `matchId`, `dimension`, `bucketKey`, `intervalFrom` |
| TRANSPORT | `tenantId`, `matchId`, `transportMode`, `intervalFrom` |
| SDK | `tenantId`, `matchId`, `sdkVersion`, `intervalFrom` |
| FAILURE | `tenantId`, `matchId`, `failureReason`, `failureStep`, `intervalFrom` |
| TIMESERIES | `tenantId`, `matchId`, `metric`, `interval`, `time` |
| LATENCY | `tenantId`, `matchId`, `intervalFrom` |

**Critical observation:** `timelineId` is **absent** from every `UNIQUE_FIELDS` array. The inline comment at line 7 confirms:
> "Tất cả đều dựa trên matchId thay vì timelineId để accumulate data từ nhiều timelines."

### Schema Unique Indexes
Every schema defines a MongoDB unique index that matches `UNIQUE_FIELDS` exactly:

- **Platform** (`overlay-metrics-platform.schema.ts` lines 86–89):
  `{ tenantId: 1, matchId: 1, platform: 1, intervalFrom: 1 }`
- **Device** (`overlay-metrics-device.schema.ts` lines 67–70):
  `{ tenantId: 1, matchId: 1, dimension: 1, bucketKey: 1, intervalFrom: 1 }`
- **Transport** (`overlay-metrics-transport.schema.ts` lines 63–66):
  `{ tenantId: 1, matchId: 1, transportMode: 1, intervalFrom: 1 }`
- **SDK** (`overlay-metrics-sdk.schema.ts` lines 57–60):
  `{ tenantId: 1, matchId: 1, sdkVersion: 1, intervalFrom: 1 }`
- **Failure** (`overlay-metrics-failure.schema.ts` lines 63–69):
  `{ tenantId: 1, matchId: 1, failureReason: 1, failureStep: 1, intervalFrom: 1 }`
- **Timeseries** (`overlay-metrics-timeseries.schema.ts` lines 67–70):
  `{ tenantId: 1, matchId: 1, metric: 1, interval: 1, time: 1 }`
- **Latency** (`overlay-metrics-latency.schema.ts` lines 109–112):
  `{ tenantId: 1, matchId: 1, intervalFrom: 1 }`

**Conclusion:** Schema-level unique constraints and repository-level upsert filters are **perfectly aligned** and both use `matchId`, not `timelineId`.

---

## 3. `matchId` vs `timelineId` in Upsert/bulkWrite

### Repository Logic
`buildUpsertOps()` (`overlay-metrics.repository.ts` lines 65–107) constructs the filter strictly from `uniqueFields`. Because `timelineId` is never in `UNIQUE_FIELDS`, it is **never part of the filter**.

However, `timelineId` **is present in the items** produced by `TransformerService` (`transformer.service.ts` grep shows every transform method includes `timelineId: ctx.timelineId`). Since `timelineId` is not in `INC_FIELDS`, it falls into the `$set` branch and is **overwritten on every upsert**.

### Behavioral Impact
- Data from multiple timelines sharing the same `matchId` + dimension + interval accumulates into **one document**.
- The stored `timelineId` always reflects the **last timeline that ran through the ETL** for that composite key.
- The `Latency` schema documents this explicitly (`overlay-metrics-latency.schema.ts` lines 48–53):
  > "`timelineId` không nằm trong unique key ... Khi nhiều timeline cùng match và interval được xử lý, field này phản ánh **timeline cuối cùng** đã góp phần vào record aggregate."

### `INC_FIELDS` Summary
| MetricType | Fields accumulated (`$inc`) |
|-----------|-----------------------------|
| PLATFORM | `sent`, `received`, `rendered`, `failed` |
| DEVICE | `received`, `rendered`, `failed` |
| TRANSPORT | `count` |
| SDK | `count` |
| FAILURE | `count` |
| TIMESERIES | `value` |
| LATENCY | `[]` (empty — percentiles cannot be summed) |

---

## 4. Multi-Tenant Connection Flow

1. **`TenantConnectionManager`** (`tenant-connection.manager.ts`):
   - Caches `mongoose.Connection` per `tenantId` in a `Map`.
   - `maxPoolSize: 10`.
   - Uses in-flight promise map to prevent race conditions during connection creation.
   - `onModuleDestroy()` closes all cached connections.

2. **`TenantModelFactory`** (`tenant-model.factory.ts`):
   - Maps each `MetricType` → `{ name, schema }`.
   - `getModelByType(tenantId, type)` calls `connectionManager.getConnection(tenantId)`, then `conn.model(name, schema)`.
   - Model is registered dynamically on the tenant-specific connection.

3. **`LoaderService`** (`loader.service.ts`):
   - Receives transformed items and simply calls `repository.upsert(tenantId, type, items)`.
   - No inline `@InjectModel`; all persistence goes through `OverlayMetricsRepository`.

---

## 5. Schema Special Cases

- **Platform** (`overlay-metrics-platform.schema.ts`): Has an extra `processed: boolean` field with `@Prop({ default: false })`.
- **Timeseries** (`overlay-metrics-timeseries.schema.ts`): Has a TTL index on `intervalFrom` with `expireAfterSeconds: 7776000` (90 days).
- **Latency** (`overlay-metrics-latency.schema.ts`): Contains nested sub-documents `PercentileSet` and `RenderDurationSet` (both `@Schema({ _id: false })`).
- **SchedulerTarget** (`scheduler-target.schema.ts`): Stored in the **root** database (not per-tenant), with `matchId` marked `@Prop({ required: true, unique: true })`.

---

## 6. Risks & Open Questions

1. **Overwriting `timelineId`**: Because `timelineId` is `$set` on every upsert, consumers reading `timelineId` from accumulated records may see stale or misleading values. Only the `Latency` schema documents this behavior; the other 6 schemas do not.
2. **Latency accumulation**: `INC_FIELDS[LATENCY]` is empty, meaning latency documents are fully overwritten (`$set`) on every run. If multiple timelines for the same `matchId` + `intervalFrom` are processed, the latency percentiles reflect only the **last timeline's ES aggregation**, not a true merge.
3. **Timeseries TTL**: The TTL is on `intervalFrom`, not `time`. If `intervalFrom` is the start of the batch window, all points in that batch expire together after 90 days, which may be intentional.
4. **Idempotency assumption**: The `$inc` logic assumes re-running the same timeline is safe, but derived metrics (`receiveRate`, `renderRate`, `percentOfFailed`, percentiles) are `$set`, so they will be recalculated and overwritten with the latest values. This is likely the intended design.

---

## Start Here
If another agent needs to modify persistence behavior, open:
- **`src/infrastructure/persistence/metric-meta.ts`** — to change unique keys or accumulate fields.
- **`src/infrastructure/persistence/overlay-metrics.repository.ts`** — to change bulkWrite semantics.
