# Transformer & Loader timelineId Flow Analysis

## Summary
`timelineId` flows **through** the ETL pipeline from `JobPayload` → `PipelineContext` → `TransformContext` → DTOs → `LoaderService` → `OverlayMetricsRepository.upsert()`. However, it is **NOT used as part of the upsert identity key**. The unique key for accumulation is `matchId + intervalFrom` (plus dimension-specific fields). `timelineId` is treated as metadata and overwritten (`$set`) on each upsert, meaning the stored value always reflects the **last timeline** that contributed to the aggregated record.

---

## Files Retrieved

1. `src/modules/overlay-metrics-etl/transformer/transformer.service.ts` (lines 24–290) — All 7 transform methods receive `TransformContext` and copy `ctx.timelineId` into every output DTO.
2. `src/modules/overlay-metrics-etl/loader/loader.service.ts` (lines 1–30) — Generic `load()` that delegates DTOs to the repository without inspecting `timelineId`.
3. `src/modules/overlay-metrics-etl/kafka/timeline-processor.service.ts` (lines 1–138) — Creates `PipelineContext` from `JobPayload` fields (`tenantId`, `matchId`, `timelineId`, `intervalFrom`, `intervalTo`).
4. `src/modules/overlay-metrics-etl/pipelines/platform.pipeline.ts` (lines 1–34) — Representative pipeline showing `PipelineContext` passed directly as `TransformContext` to the transformer.
5. `src/modules/overlay-metrics-etl/pipelines/pipeline.context.ts` (lines 1–28) — Interface definition; identical shape to `TransformContext`.
6. `src/modules/overlay-metrics-etl/interfaces/transform-context.interface.ts` (lines 1–7) — Defines `TransformContext` with `timelineId`, `matchId`, `tenantId`, `intervalFrom`, `intervalTo`.
7. `src/infrastructure/persistence/overlay-metrics.repository.ts` (lines 1–96) — `upsert()` builds `bulkWrite` ops using `UNIQUE_FIELDS` and `INC_FIELDS`; `timelineId` is not special-cased.
8. `src/infrastructure/persistence/metric-meta.ts` (lines 1–56) — Defines composite unique keys per `MetricType`. None include `timelineId`.
9. `src/domain/schemas/overlay-metrics-platform.schema.ts` (lines 71–76) — Unique index is `{ tenantId, matchId, platform, intervalFrom }`; `timelineId` is just a required `@Prop`.
10. `src/domain/schemas/overlay-metrics-latency.schema.ts` (lines 88–94) — Explicit TSDoc comment: *"`timelineId` không nằm trong unique key... phản ánh timeline cuối cùng đã góp phần vào record aggregate."*

---

## Key Code

### 1. TransformContext shape
`src/modules/overlay-metrics-etl/interfaces/transform-context.interface.ts`
```ts
export interface TransformContext {
  timelineId: string;
  matchId: string;
  tenantId: string;
  intervalFrom: Date;
  intervalTo: Date;
}
```

### 2. Transformer copies ctx fields into DTOs
`src/modules/overlay-metrics-etl/transformer/transformer.service.ts` (excerpt from `transformPlatformMetrics`)
```ts
return {
  timelineId: ctx.timelineId,
  matchId: ctx.matchId,
  tenantId: ctx.tenantId,
  platform: String(bucket.key || 'unknown'),
  // ... metrics ...
  intervalFrom: ctx.intervalFrom,
  intervalTo: ctx.intervalTo,
};
```
Every transform method follows the same pattern.

### 3. Loader is a blind pass-through
`src/modules/overlay-metrics-etl/loader/loader.service.ts`
```ts
async load(
  tenantId: string,
  type: MetricType,
  items: unknown[],
): Promise<void> {
  if (!items.length) return;
  await this.repository.upsert(
    tenantId,
    type,
    items as Record<string, unknown>[],
  );
}
```

### 4. Repository upsert keys (no timelineId)
`src/infrastructure/persistence/metric-meta.ts`
```ts
export const UNIQUE_FIELDS: Record<MetricType, string[]> = {
  [MetricType.PLATFORM]:  ['tenantId', 'matchId', 'platform', 'intervalFrom'],
  [MetricType.DEVICE]:    ['tenantId', 'matchId', 'dimension', 'bucketKey', 'intervalFrom'],
  [MetricType.TRANSPORT]: ['tenantId', 'matchId', 'transportMode', 'intervalFrom'],
  [MetricType.SDK]:       ['tenantId', 'matchId', 'sdkVersion', 'intervalFrom'],
  [MetricType.FAILURE]:   ['tenantId', 'matchId', 'failureReason', 'failureStep', 'intervalFrom'],
  [MetricType.TIMESERIES]:['tenantId', 'matchId', 'metric', 'interval', 'time'],
  [MetricType.LATENCY]:   ['tenantId', 'matchId', 'intervalFrom'],
};
```

### 5. Schema documents the overwrite behavior
`src/domain/schemas/overlay-metrics-latency.schema.ts`
```ts
/**
 * **Lưu ý:** `timelineId` không nằm trong unique key của latency
 * (`tenantId + matchId + intervalFrom`). Khi nhiều timeline cùng match
 * và interval được xử lý, field này phản ánh **timeline cuối cùng**
 * đã góp phần vào record aggregate.
 */
@Prop({ required: true })
timelineId!: string;
```

---

## Architecture / Data Flow

```
JobPayload (Kafka/Scheduler)
  ├── timelineId
  ├── matchId
  ├── tenantId
  ├── intervalFrom / intervalTo (or derived from timeRangeMinutes)
  ↓
TimelineProcessorService.processTimeline()
  └── builds PipelineContext { timelineId, matchId, tenantId, intervalFrom, intervalTo, query }
      ↓
MetricPipeline.execute(ctx)               // e.g. PlatformPipeline
  ├── extractor.queryPlatformMetrics(ctx.query)
  ├── transformer.transformPlatformMetrics(aggs, ctx)
  │     └── DTOs contain: timelineId, matchId, tenantId, intervalFrom, intervalTo
  └── loader.load(ctx.tenantId, MetricType.PLATFORM, dtos)
        ↓
OverlayMetricsRepository.upsert()
  ├── filter = { tenantId, matchId, platform, intervalFrom }   // UNIQUE_FIELDS
  ├── $inc  = { sent, received, rendered, failed }             // INC_FIELDS
  ├── $set  = { timelineId, ...all other non-inc fields }      // timelineId OVERWRITTEN
  └── $setOnInsert = { createdAt }
```

### Why this matters
- **Accumulation design:** Multiple timelines for the same `matchId` and `intervalFrom` are intentionally collapsed into a single MongoDB record. Raw counts are accumulated (`$inc`), but metadata like `timelineId` is overwritten (`$set`).
- **Read API implication:** If consumers expect `timelineId` to uniquely identify a record, they will be surprised — the same `{matchId, intervalFrom}` record can have its `timelineId` change on every ETL run.
- **TSDoc accuracy:** The latency schema explicitly documents this, but other schemas (platform, device, etc.) do not have the same warning comment even though they behave identically.

---

## Start Here
Open `src/modules/overlay-metrics-etl/pipelines/platform.pipeline.ts` to see how `PipelineContext` (which carries `timelineId`) is passed directly into `TransformerService`, then cross-reference with `src/infrastructure/persistence/metric-meta.ts` to confirm the upsert unique key excludes `timelineId`.

---

## Open Questions / Risks
1. **Consistency of documentation:** Only the latency schema documents that `timelineId` reflects the last contributing timeline. Should the other 6 schemas add the same note?
2. **API contract:** Do downstream API consumers rely on `timelineId` for filtering or grouping? The `MetricsQueryDto` only exposes `matchId`, `timelineIds`, `from`, `to` — but `OverlayMetricsRepository.find()` does a simple `find(filter)` pass-through, so a caller *could* filter by `timelineId` and get confusing results if multiple timelines were aggregated.
3. **timeseries unique key:** Timeseries uses `time` instead of `intervalFrom`, which means it does not collapse multiple timelines at all for the same `{matchId, metric, interval, time}` — it accumulates `value` instead. This is consistent with the overall design but worth noting.
