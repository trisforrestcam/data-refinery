# Latency ETL Pipeline Audit Report

**Date:** 2026-05-15  
**Auditor:** Review Subagent  
**Scope:** End-to-end latency percentile flow — Elasticsearch aggregation → Transformer → TimelineProcessor → Loader → Repository → MongoDB schema.

---

## 1. Executive Summary

The latency ETL pipeline is **structurally sound** and will correctly persist `LatencyPercentileDto` into MongoDB per tenant. No **CRITICAL** or **HIGH** severity bugs were found that would prevent latency data from being saved at runtime.

However, there are **2 MEDIUM** issues (ES query redundancy and semantic field ambiguity) and **3 LOW** issues (test mock inaccuracy, unstable `timelineId` on overwrite, and test coverage gap) that should be addressed for efficiency and maintainability.

---

## 2. End-to-End Flow Verification

| Step | Component | Finding | Severity |
|------|-----------|---------|----------|
| 2.1 | `TrackingEsService.queryLatency` | 8 aggregations declared; names match `LatencyAggs` interface | ✅ Correct |
| 2.2 | `LatencyAggs` type definition | All 8 optional properties mirror ES query exactly | ✅ Correct |
| 2.3 | `TransformerService.transformLatency` | Maps `values['50.0'…'99.0']`, `stats.avg/max` correctly; fallback for `renderDuration.avg` present | ✅ Correct |
| 2.4 | `TimelineProcessorService` | Calls `extractLatency` → `transformLatency` → `loadLatency(ctx.tenantId, [latencyData])` in correct order; wraps single object in array | ✅ Correct |
| 2.5 | `LoaderService.loadLatency` | Delegates to `repository.upsert(tenantId, MetricType.LATENCY, items)` | ✅ Correct |
| 2.6 | `OverlayMetricsRepository.upsert` | Uses `UNIQUE_FIELDS[LATENCY]` = `['tenantId','matchId','intervalFrom']` and `INC_FIELDS[LATENCY]` = `[]` | ✅ Correct |
| 2.7 | `TenantModelFactory` | Maps `MetricType.LATENCY` → `OverlayMetricsLatencySchema` | ✅ Correct |
| 2.8 | `OverlayMetricsLatency` schema | Unique index `{tenantId, matchId, intervalFrom}` aligns with `UNIQUE_FIELDS`; required nested objects (`receive`, `render`, `ack`, `renderDuration`) match DTO shape | ✅ Correct |

---

## 3. Detailed Findings

### 3.1 MEDIUM — ES Query Redundancy: `render_duration` and `render_duration_stats` are duplicates

**Location:**
- `src/modules/overlay-metrics-etl/extractor/elasticsearch/tracking-es.service.ts`
  - `render_latency` aggregation: lines 245-251
  - `render_stats` aggregation: lines 258-260
  - `render_duration` aggregation: lines 275-280
  - `render_duration_stats` aggregation: lines 281-283

**Evidence:**
```typescript
// Already queries percentiles [50,75,95,99] on numeric_labels.render_duration_ms
render_latency: { percentiles: { field: 'numeric_labels.render_duration_ms', percents: [50, 75, 95, 99] } }

// Already queries stats on the same field
render_stats: { stats: { field: 'numeric_labels.render_duration_ms' } }

// REDUNDANT — subset of percentiles on identical field
render_duration: { percentiles: { field: 'numeric_labels.render_duration_ms', percents: [50, 95, 99] } }

// REDUNDANT — identical stats on identical field
render_duration_stats: { stats: { field: 'numeric_labels.render_duration_ms' } }
```

**Impact:**
- 2 out of 8 latency aggregations (25%) perform redundant work on the Elasticsearch cluster.
- Slightly increased query latency and CPU load on ES for every timeline processed.

**Recommendation:**
- Remove `render_duration` and `render_duration_stats` aggregations from the ES query.
- In `transformLatency`, read `renderDuration.p50/p95/p99` directly from `render_latency.values` and `renderDuration.avg` from `render_stats.avg`.
- This reduces the query to 6 aggregations and eliminates the overlap.

---

### 3.2 MEDIUM — Semantic Ambiguity: `render_latency` queries `render_duration_ms`

**Location:**
- `src/modules/overlay-metrics-etl/extractor/elasticsearch/tracking-es.service.ts`, lines 245-251

**Evidence:**
```typescript
render_latency: {
  percentiles: {
    field: 'numeric_labels.render_duration_ms',  // <-- same field as render_duration
    percents: [50, 75, 95, 99],
  },
},
```

**Analysis:**
- `receive_latency` queries `numeric_labels.receive_latency_ms`.
- `ack_latency` queries `numeric_labels.ack_latency_ms`.
- By naming symmetry, `render_latency` should logically query `numeric_labels.render_latency_ms`.
- Instead it queries `numeric_labels.render_duration_ms`, which is the same field used by `render_duration`.
- The DTO defines two distinct concepts (`render`: `PercentileSet` with p75, and `renderDuration`: `RenderDurationSet` without p75), yet they derive from the same raw ES field.

**Impact:**
- If the index actually contains a separate `numeric_labels.render_latency_ms` field (e.g., time-to-first-byte vs. full render duration), the pipeline is silently displaying the wrong metric under the "render latency" label.
- If no such field exists, the `render` vs `renderDuration` separation in the DTO/schema is semantically redundant and may confuse consumers of the Read API.

**Recommendation:**
- Verify the actual Elasticsearch mapping for `tracking-events-*`.
- If `render_latency_ms` exists, update `queryLatency` to use it for `render_latency`.
- If it does not exist, document explicitly that "render latency" is measured by render duration, and consider collapsing the two DTO fields to reduce confusion.

---

### 3.3 LOW — Test Mock Data Includes Impossible ES Response Key

**Location:**
- `test/use-cases/UC-07-latency-percentile.spec.ts`, line 58

**Evidence:**
```typescript
render_duration: {
  values: { '50.0': 50, '75.0': 70, '95.0': 115, '99.0': 205 },
},
```

**Analysis:**
- `queryLatency` requests `percents: [50, 95, 99]` for `render_duration`.
- Elasticsearch will **never** return a `'75.0'` key for this aggregation.
- The test passes because `transformLatency` only reads `50.0`, `95.0`, `99.0`, ignoring the extra key.

**Impact:**
- Test does not accurately mirror production ES behavior.
- May mislead future maintainers into thinking `render_duration` includes p75.

**Recommendation:**
- Remove `'75.0': 70` from the test mock.

---

### 3.4 LOW — Unstable `timelineId` on Multi-Timeline Match Overwrite

**Location:**
- `src/infrastructure/persistence/metric-meta.ts`, line 15
- `src/domain/schemas/overlay-metrics-latency.schema.ts`, lines 78-81 and 132-135

**Evidence:**
```typescript
// metric-meta.ts
[MetricType.LATENCY]: ['tenantId', 'matchId', 'intervalFrom'],

// overlay-metrics-latency.schema.ts
@Prop({ required: true })
timelineId!: string;

OverlayMetricsLatencySchema.index(
  { tenantId: 1, matchId: 1, intervalFrom: 1 },
  { unique: true },
);
```

**Analysis:**
- `timelineId` is required in the schema and present in the DTO, but it is **not** part of the unique key.
- When multiple timelines belong to the same `matchId` + `intervalFrom`, the `$set` in `bulkWrite` will overwrite `timelineId` with the ID of whichever timeline was processed last.
- This is intentional for accumulation (percentiles cannot be mathematically merged), but it makes `timelineId` an unreliable field for latency documents.

**Impact:**
- Any downstream query or audit that filters latency by `timelineId` may return inconsistent results depending on pipeline execution order.

**Recommendation:**
- Document explicitly that `timelineId` on latency records represents the *last processed* timeline for the match+interval window.
- Alternatively, remove `timelineId` from the latency schema if it serves no reliable purpose, or make it part of the unique key if per-timeline latency isolation is desired.

---

### 3.5 LOW — Test Coverage Gap: No Repository or ModelFactory Test for Latency

**Location:**
- Test suite: `test/use-cases/UC-07-latency-percentile.spec.ts`
- Missing: `test/unit/overlay-metrics.repository.spec.ts` or similar

**Evidence:**
- `UC-07` tests:
  1. ES query shape (TrackingEsService)
  2. Transformer mapping (TransformerService)
  3. Edge case null values (TransformerService)
- No test verifies that `OverlayMetricsRepository.upsert` with `MetricType.LATENCY` produces the correct `bulkWrite` ops.
- No test verifies that `TenantModelFactory.getModelByType(MetricType.LATENCY)` resolves to `OverlayMetricsLatencySchema`.
- No test verifies idempotent rerun (duplicate key) behavior for latency.
- No integration test asserts that data actually lands in MongoDB.

**Impact:**
- A regression in `metric-meta.ts` (e.g., accidentally changing `UNIQUE_FIELDS[LATENCY]`) would not be caught by existing tests.
- A regression in `TenantModelFactory` schema mapping would fail only at runtime.

**Recommendation:**
- Add a unit test for `OverlayMetricsRepository.buildUpsertOps` with a `LatencyPercentileDto` payload, asserting:
  - Filter contains `tenantId`, `matchId`, `intervalFrom`.
  - `$inc` is absent (because `INC_FIELDS` is empty).
  - `$set` contains nested objects `receive`, `render`, `ack`, `renderDuration`.
- Add a unit test for `TenantModelFactory` asserting the schema map includes all 7 metric types.

---

## 4. Correct Behavior (Positive Findings)

### 4.1 ES Query Field Names Match Type Definitions
`queryLatency` defines aggregations: `receive_latency`, `render_latency`, `ack_latency`, `receive_stats`, `render_stats`, `ack_stats`, `render_duration`, `render_duration_stats`.  
`LatencyAggs` interface (`tracking-es-aggs.types.ts`, lines 90-97) declares exactly these 8 optional properties with correct types (`EsAggValues` for percentiles, `EsAggStats` for stats).  
**Verdict:** No mismatch.

### 4.2 Transformer Guarantees All Schema Required Fields
`normalizeValue` (`transformer.service.ts`, lines 216-219) converts `null`, `undefined`, `NaN`, and `Infinity` to `0`.  
Since every field in `LatencyPercentileDto` flows through `normalizeValue`, MongoDB schema validation (`required: true`) will never fail due to missing numeric values.  
**Verdict:** Runtime-safe against empty ES windows.

### 4.3 Processor Wraps Latency Correctly
`TimelineProcessorService.executeTimelinePipeline` (`timeline-processor.service.ts`, lines 168-174):
```typescript
const latencyData = this.transformer.transformLatency(latencyAgg.aggregations, ctx);
await this.loader.loadLatency(ctx.tenantId, [latencyData]);
```
The single DTO is explicitly wrapped in an array before passing to `LoaderService.loadLatency`, which expects `LatencyPercentileDto[]`.  
**Verdict:** Type-safe and correct.

### 4.4 Repository Upsert Logic is Idempotent for Latency
`INC_FIELDS[LATENCY]` is `[]` (`metric-meta.ts`, line 28).  
Therefore `buildUpsertOps` places **all** fields into `$set`, causing a full overwrite on re-run. For percentiles (derived metrics that cannot be accumulated), replacement is the correct idempotency strategy.  
**Verdict:** Correct semantic behavior.

### 4.5 Schema Unique Index Matches Upsert Filter
Schema unique index: `{ tenantId: 1, matchId: 1, intervalFrom: 1 }`  
`UNIQUE_FIELDS[LATENCY]`: `['tenantId', 'matchId', 'intervalFrom']`  
**Verdict:** Perfect alignment; no duplicate-key surprises.

### 4.6 TenantModelFactory Maps Latency Correctly
`TenantModelFactory.schemaMap[MetricType.LATENCY]` points to `OverlayMetricsLatencySchema` (`tenant-model.factory.ts`, lines 44-47).  
**Verdict:** Schema resolution is correct.

---

## 5. Recommendations Summary

| Priority | Action | File(s) |
|----------|--------|---------|
| P1 (Medium) | Remove redundant `render_duration` and `render_duration_stats` aggregations; update transformer to read from `render_latency` / `render_stats` instead. | `tracking-es.service.ts`, `transformer.service.ts` |
| P1 (Medium) | Verify ES mapping: confirm whether `numeric_labels.render_latency_ms` exists; if so, use it for `render_latency` aggregation. | ES mapping audit |
| P2 (Low) | Fix test mock: remove `'75.0'` from `render_duration.values` in UC-07. | `test/use-cases/UC-07-latency-percentile.spec.ts` |
| P2 (Low) | Document `timelineId` overwrite behavior for latency, or remove it from schema if unused. | `overlay-metrics-latency.schema.ts`, `AGENTS.md` |
| P2 (Low) | Add unit tests for `Repository.buildUpsertOps` and `TenantModelFactory` schema map coverage. | New test files |

---

*Audit complete. No blockers preventing latency data from being saved to MongoDB.*
