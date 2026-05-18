# Extractor Analysis — Timeline / Match / Time-Range Filtering in ES Queries

## TL;DR

- **`extractor.service.ts` does not exist.** The ETL extraction layer is implemented as **7 pipeline classes** inside `src/modules/overlay-metrics-etl/pipelines/`.
- All ES aggregation queries are built in **`TrackingEsService`** (`src/modules/overlay-metrics-etl/extractor/elasticsearch/tracking-es.service.ts`).
- **ES filters by:** `tenantId` (required), `timelineId` (optional, but always set by ETL), `@timestamp` range (optional, but always set by ETL), `environment` (required), plus optional `mediaContentId` / `platform`.
- **`matchId` is NOT filtered in Elasticsearch.** It only lives in `PipelineContext` and is used downstream (Transformer + Loader + MongoDB persistence).

---

## 1. How `timelineId`, `matchId`, and interval are wired

### Source of truth: `TimelineProcessorService`
`src/modules/overlay-metrics-etl/kafka/timeline-processor.service.ts` (lines 131–140)

```typescript
const ctx: PipelineContext = {
  tenantId,
  matchId,
  timelineId,
  intervalFrom,
  intervalTo,
  query: {
    timelineIds: [timelineId],   // ← passed to ES
    tenantId,                     // ← passed to ES
    from: intervalFrom,           // ← passed to ES
    to: intervalTo,               // ← passed to ES
  },
};
```

| Field | Sent to ES? | How it reaches ES |
|---|---|---|
| `tenantId` | ✅ Yes | `TrackingAggQuery.tenantId` → `buildBaseQuery` `term: { labels.tenant_id }` |
| `timelineId` | ✅ Yes | `TrackingAggQuery.timelineIds` → `buildBaseQuery` `terms: { labels.timeline_id }` |
| `matchId` | ❌ **No** | Only in `PipelineContext`; never added to `TrackingAggQuery` |
| `intervalFrom` | ✅ Yes | `TrackingAggQuery.from` → `buildBaseQuery` `range: { '@timestamp': { gte } }` |
| `intervalTo` | ✅ Yes | `TrackingAggQuery.to` → `buildBaseQuery` `range: { '@timestamp': { lt } }` |

---

## 2. ES Query Builder (`buildBaseQuery`)

**File:** `src/modules/overlay-metrics-etl/extractor/elasticsearch/tracking-es.service.ts` (lines 418–478)

Logic summary:
1. **Must** `term: { 'labels.tenant_id': query.tenantId }`
2. **Must** `term: { 'labels.environment': env }` (from query or config)
3. **If** `query.timelineIds?.length` → `terms: { 'labels.timeline_id': query.timelineIds }`
4. **If** `query.mediaContentId` → `term: { 'labels.media_content_id': query.mediaContentId }`
5. **If** `query.from` or `query.to` → `range: { '@timestamp': { gte: from, lt: to } }`
6. **If** `query.platform` → `term: { 'labels.platform': query.platform }`

> **Observation:** `matchId` is not a field in `TrackingAggQuery`, therefore it is never injected into the `bool.must` array.

---

## 3. The 7 Extraction Methods

All methods delegate to `executeAgg<TAggs>(query, aggs)`, which wraps `ElasticsearchService.search` with `size: 0` and the base query above.

| # | Method | File (lines) | What it aggregates | ES Query Details |
|---|---|---|---|---|
| 1 | `queryPlatformMetrics` | `tracking-es.service.ts` (74–118) | Platform funnel: sent, received, rendered, failed per platform | `terms(labels.platform)` → sub-aggs: `filter(stage=sent)` + `sum(room_size)`, `filter(stage=received)` doc_count, `filter(stage=rendered)` + `avg(render_duration_ms)`, `filter(stage=render-failed)` doc_count |
| 2 | `queryDeviceBreakdown` | `tracking-es.service.ts` (121–166) | Device breakdown by dimension | `terms(labels.browser \| client_os \| device_class)` → `filters(received, rendered, failed)` → `avg(render_duration_ms)` per stage. Called 3 times (browser, os, deviceClass). |
| 3 | `queryTransportComparison` | `tracking-es.service.ts` (169–211) | Transport mode comparison | `terms(labels.transport_mode)` → `filters(received, rendered)` → `avg(render_duration_ms)` + `percentiles(render_duration_ms, [95])` |
| 4 | `querySdkVersions` | `tracking-es.service.ts` (214–252) | SDK version distribution | `terms(labels.sdk_version)` → `filters(received, rendered)` → `avg(render_duration_ms)` |
| 5 | `queryFailures` | `tracking-es.service.ts` (255–284) | Failure reason × step | `terms(labels.failure_reason)` → `terms(labels.failure_step)` (two-level nested terms) |
| 6 | `queryLatency` | `tracking-es.service.ts` (287–342) | Latency percentiles & stats | **Top-level** (no bucket split): `percentiles(receive_latency_ms, [50,75,95,99])`, `percentiles(render_duration_ms, ...)`, `percentiles(ack_latency_ms, ...)`, plus `stats` for each field. |
| 7 | `queryTimeseries` | `tracking-es.service.ts` (345–399) | Timeseries points | `date_histogram(@timestamp, fixed_interval)` → dynamic `metric_value` agg depending on metric: `sum(room_size)` for sent, `filter(stage)` for received/rendered/failed, `avg(render_duration_ms)` for avgRenderMs. Called 5 times (sent, received, rendered, failed, avgRenderMs). |

---

## 4. Pipeline Facades (where the 7 methods are invoked)

Since `extractor.service.ts` is absent, the actual callers are:

| MetricType | Pipeline Class | Calls to `TrackingEsService` |
|---|---|---|
| `PLATFORM` | `PlatformPipeline` | `queryPlatformMetrics(ctx.query)` |
| `DEVICE` | `DevicePipeline` | `queryDeviceBreakdown(ctx.query, dimension)` × 3 |
| `TRANSPORT` | `TransportPipeline` | `queryTransportComparison(ctx.query)` |
| `SDK` | `SdkPipeline` | `querySdkVersions(ctx.query)` |
| `FAILURE` | `FailurePipeline` | `queryFailures(ctx.query)` |
| `LATENCY` | `LatencyPipeline` | `queryLatency(ctx.query)` |
| `TIMESERIES` | `TimeseriesPipeline` | `queryTimeseries(ctx.query, metric, '5m')` × 5 |

**Files:**
- `src/modules/overlay-metrics-etl/pipelines/platform.pipeline.ts`
- `src/modules/overlay-metrics-etl/pipelines/device.pipeline.ts`
- `src/modules/overlay-metrics-etl/pipelines/transport.pipeline.ts`
- `src/modules/overlay-metrics-etl/pipelines/sdk.pipeline.ts`
- `src/modules/overlay-metrics-etl/pipelines/failure.pipeline.ts`
- `src/modules/overlay-metrics-etl/pipelines/latency.pipeline.ts`
- `src/modules/overlay-metrics-etl/pipelines/timeseries.pipeline.ts`

---

## 5. Open Questions / Risks

1. **Missing `matchId` in ES filter:** If a single `timelineId` could theoretically belong to multiple `matchId`s over time, the ES query would still return the same documents. Currently the Loader/Repository uses `matchId` for the MongoDB unique key / accumulation, so the risk is low **if** `timelineId` is globally unique. If not, there is a potential cross-match data leak at the extraction stage.
2. **Unused `mediaContentId` in ETL path:** `TrackingAggQuery.mediaContentId` exists but is never populated by `TimelineProcessorService`. It may be used only by the realtime read path (`RealtimeService`).
3. **Index pattern:** All queries hit `tracking-events-*` (configurable via `elasticsearch.trackingIndex`).

---

*Scout completed: 2026-05-18*
