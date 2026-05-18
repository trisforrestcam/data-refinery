# Test Coverage Analysis: Full-Flow Kafka → ES → MongoDB

## Executive Summary

**No true integration or end-to-end test exists** that exercises the complete flow from Kafka consumer → Elasticsearch query → MongoDB insert with a real database instance.

- `test/integration/` — **empty directory**
- `test/e2e/` — **empty directory**
- `test/app.e2e-spec.ts` — only tests `GET /` returns `"Hello World!"`; does not touch ETL pipeline at all.

All "full-flow" coverage is achieved via **use-case unit tests** in `test/use-cases/` that mock every external dependency (KafkaJS, Elasticsearch client, MongoDB `bulkWrite`). The most complete mocks are UC-13 (idempotent rerun with a hand-rolled MongoDB state simulator) and UC-14 (partial failure with in-memory state arrays).

---

## Directory Inventory

| Directory / File | Count | Nature |
|------------------|-------|--------|
| `test/integration/` | 0 files | Empty |
| `test/e2e/` | 0 files | Empty |
| `test/app.e2e-spec.ts` | 1 test | Superficial e2e (Hello World) |
| `test/unit/*.spec.ts` | 4 files | Isolated unit tests (Kafka consumer/producer, job producer, timeline processor) |
| `test/use-cases/UC-*.spec.ts` | 19 files | Use-case-driven unit tests; mock all I/O |

---

## Tests That Mock ES Returning "Real" Data

These tests construct realistic ES aggregation responses and assert transform + loader call arguments. They do **NOT** assert actual MongoDB state (except UC-13 and UC-14, which simulate state in-memory).

| Test | ES Mock Data | Loader / Mongo Assertion |
|------|--------------|--------------------------|
| `UC-02-platform-metrics.spec.ts` | 3 platforms (`web`, `ios`, `android`) with `sent`, `received`, `rendered`, `failed`, `avg_render_ms` | `loadMock` called with expected `PlatformMetricDto[]` |
| `UC-03-device-breakdown.spec.ts` | `browser`, `os`, `deviceClass` dimensions with multi-bucket aggs | `loader.load` called 3×; `deviceModel.bulkWrite` called 3× |
| `UC-04-transport-p95.spec.ts` | 3 transport modes (`websocket`, `webrtc`, `http`) with `p95_render_ms` | Asserts transformed `TransportComparisonDto[]`; no loader mock invoked |
| `UC-05-sdk-version.spec.ts` | 5 SDK versions with `received` / `rendered` | Asserts transformed `SdkVersionDto[]`; no loader mock invoked |
| `UC-06-failure-analysis.spec.ts` | 3 failure reasons × nested steps | Asserts transformed `FailureAnalysisDto[]` with `percentOfFailed`; no loader mock |
| `UC-07-latency-percentile.spec.ts` | Full percentile + stats aggs (`receive_latency`, `render_latency`, `ack_latency`) | Asserts `LatencyPercentileDto` structure; no loader mock |
| `UC-08-timeseries.spec.ts` | 10-bucket `date_histogram` for 5 metrics (`sent`, `received`, `rendered`, `failed`, `avgRenderMs`) | Asserts `TimeseriesPointDto[]` per metric; no loader mock |
| `UC-10-partial-data.spec.ts` | Partial / malformed aggs (`NaN`, `null`, `undefined` values) across all 7 metric types | `loaderMock.load` called 13×; asserts normalized DTOs passed to loader |

### Key Observation
These tests verify **correctness of Extract → Transform** and that the **Loader receives the right DTOs**, but they stop at the `LoaderService.load()` boundary. They do not verify that `OverlayMetricsRepository` actually builds the correct `bulkWrite` ops or that MongoDB documents end up in the expected state.

---

## Tests Covering "Real Data" vs "Empty Data"

### Real Data Scenarios
- **UC-02** through **UC-08** — Each metric type with realistic bucket counts and values.
- **UC-10** — Partial / corrupted real data (NaN, null, missing keys); asserts normalization to `0` and pipeline completion.
- **UC-13** — Two full runs with non-zero platform metrics (`web`, `ios`, `android`) to test `$inc` accumulation.
- **UC-14** — Simulated persist of real documents per pipeline; asserts which docs survive when one pipeline throws.

### Empty Data Scenarios
- **UC-09-empty-window.spec.ts** — ES returns `{ aggregations: {}, took: 0 }` for every query.
  - Asserts `TransformerService` returns empty arrays / zeroed `LatencyPercentileDto`.
  - Asserts `LoaderService` early-returns **without** calling `bulkWrite` on any model.
  - Asserts `TimelineProcessorService` completes successfully despite all 13 ES queries being empty.

### Gap: No Cross-Metric Full-Flow with Real MongoDB
There is **no test** that:
1. Spins up a real MongoDB (or even uses `mongodb-memory-server`).
2. Runs the actual `TimelineProcessorService` with real `TrackingEsService` + `TransformerService` + `LoaderService` + `OverlayMetricsRepository`.
3. Queries the resulting documents back out of MongoDB to assert end-state.

---

## Closest Approximations to Full-Flow Tests

### UC-13 — Idempotent Rerun (`test/use-cases/UC-13-idempotent-rerun.spec.ts`)
- **What it does:**
  - Mocks `TimelineProcessorService` with a custom `MetricPipeline` for PLATFORM that calls a mocked extractor → transformer → **real** `LoaderService` + `OverlayMetricsRepository`.
  - Provides a **hand-rolled in-memory MongoDB model** (`createPlatformModel`) that simulates `bulkWrite` with `$inc`, `$set`, `$setOnInsert`, and `$currentDate` semantics.
  - Runs the processor twice with the same interval and asserts accumulated counts (e.g., `sent: 120` = `50 + 70`).
- **What's mocked:**
  - Kafka layer entirely absent.
  - ES layer mocked (returns `{ aggregations: { runIndex } }`).
  - Transformer mocked (returns pre-canned DTO arrays based on `runIndex`).
  - MongoDB is not real; it is a `Map<string, StoredPlatformDoc>` inside the test.
- **MongoDB assertions:**
  - `platformModel.countDocuments()` → `3` after first run, `3` after second run.
  - `platformModel.getDocuments()` → verifies `$inc` accumulation and `$set` override of derived fields.

### UC-14 — Pipeline Partial Failure (`test/use-cases/UC-14-pipeline-partial-failure.spec.ts`)
- **What it does:**
  - Creates 7 mock pipelines where each "persists" to an in-memory `MongoState` array.
  - Forces 1 pipeline to throw (`device`, `sdk`, or `timeseries`).
  - Asserts that pipelines **before** the failure kept their data, pipeline **after** the failure still ran, and the failed pipeline contributed nothing.
- **What's mocked:**
  - Every pipeline is a pure Jest mock; no real ES, Transformer, Loader, or Repository involved.
  - MongoDB state is just `Record<string, unknown>[]` arrays.
- **MongoDB assertions:**
  - Array lengths per metric type (e.g., `mongoState.platform.length === 1`).

### UC-12 — MongoDB Duplicate Key (`test/use-cases/UC-12-mongodb-duplicate-key.spec.ts`)
- **What it does:**
  - Mocks `TenantModelFactory` to return models whose `bulkWrite` rejects with `MongoServerError` code `11000`.
  - Asserts the error propagates up through `LoaderService` → `TimelineProcessorService` and surfaces as a aggregated pipeline failure string.
- **MongoDB assertions:**
  - None on document state; only asserts error propagation and that `bulkWrite` was called with correct `updateOne` filter + `upsert: true`.

---

## Unit Tests (Isolated Components)

| File | Scope |
|------|-------|
| `test/unit/timeline-processor.service.spec.ts` | `TimelineProcessorService` with fully mocked pipelines; asserts context shape, error aggregation, payload validation |
| `test/unit/kafka-consumer.service.spec.ts` | `KafkaConsumerService` with mocked KafkaJS consumer; asserts retry republish, DLQ on max retries, offset commit logic |
| `test/unit/kafka-producer.service.spec.ts` | `KafkaProducerService` with mocked KafkaJS producer; asserts topic, message key, payload schema, DLQ message shape |
| `test/unit/job-producer.service.spec.ts` | `JobProducerService` with mocked `SchedulerConfigService`; asserts cron produces 1 message per timeline |

None of these touch ES or MongoDB.

---

## Gaps & Risks

1. **No real MongoDB in tests**
   - `TenantConnectionManager`, `TenantModelFactory`, and actual Mongoose schema validations are never exercised in an integrated fashion.
   - Risk: Schema mismatches, index misconfigurations, or TTL issues are caught only in production.

2. **No real ES in tests**
   - ES query shapes are verified (UC-17), but no test runs against an actual ES instance or TestContainers ES.
   - Risk: Breaking changes in ES v9 query/response semantics go undetected if mocks drift from reality.

3. **Kafka consumer → Processor → MongoDB is never wired end-to-end**
   - UC-11 tests Kafka retry logic with a mocked `TimelineProcessorService`.
   - UC-01 tests processor pipeline orchestration with mocked pipelines.
   - No single test connects all three layers.

4. **"Real data" tests stop at loader boundary**
   - UC-02 through UC-08 prove extraction + transformation correctness, but the repository `bulkWrite` op construction is only indirectly tested via UC-12 and UC-13.

5. **Missing cross-tenant isolation test**
   - Multi-tenancy logic (`TenantModelFactory`, `TenantConnectionManager`) has no automated integration verification.

---

## Recommendations

If the goal is to have confidence in the full flow, consider adding (in priority order):

1. **Integration test with `mongodb-memory-server`**
   - Run `TimelineProcessorService` with real `TrackingEsService`, `TransformerService`, `LoaderService`, `OverlayMetricsRepository`, and an in-memory MongoDB.
   - Mock only the ES client (`ElasticsearchService.search`) and Kafka layer.
   - Assert documents are queryable from the DB after processing.

2. **Backfill the empty `test/integration/` directory**
   - One test per metric type that goes: mocked ES agg → processor → real repository → real MongoDB.

3. **Expand UC-13 pattern**
   - Convert UC-13 from an in-memory Map mock to a real Mongoose model backed by `mongodb-memory-server`, keeping the same accumulation assertions.

4. **Add a Kafka → Processor → MongoDB contract test**
   - Use a lightweight Kafka testcontainer or simply invoke `TimelineProcessorService.processTimeline` directly with a payload, then read back from MongoDB.
