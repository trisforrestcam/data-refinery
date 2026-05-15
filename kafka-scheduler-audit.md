# Kafka Scheduler & Backfill Flow Audit Report

**Date:** 2026-05-15
**Scope:** JobProducerService, KafkaConsumerService, KafkaProducerService, TimelineProcessorService, SchedulerConfigService, MetricsApiService, SchedulerTarget schema, UC-14 partial failure test
**Focus areas:** Message production, consumer retry/DLQ, pipeline step ordering, backfill flow, missing latency data root cause

---

## 1. JobProducerService.handleCron — Message Production

**File:** `src/modules/overlay-metrics-etl/kafka/job-producer.service.ts`
**Lines:** 27–50

### Correct
- Cron expression `@Cron('0 * * * *')` runs exactly at minute 0 every hour, matching the architecture spec.
- Each target/timeline combination produces a separate message with `origin: 'scheduled'`, ensuring per-timeline processing isolation.
- Total message count is logged after production.

### Blocker
- **No error handling around `kafkaProducer.sendJob` inside nested loops.** If a single `sendJob` throws (e.g., transient Kafka broker disconnect), the entire `handleCron` throws, and all remaining target/timeline messages are **skipped**.
  - *Location:* Line 38 (`await this.kafkaProducer.sendJob(...)` inside `for...of` loops).
  - *Severity:* **High** — partial cron production leads to missing intervals for some timelines.

### Note
- Sequential `await` in nested loops means production is O(N×M) blocking. For many targets/timelines, this extends cron execution time without parallelism.

---

## 2. KafkaConsumerService — Retry Logic & DLQ

**File:** `src/modules/overlay-metrics-etl/kafka/kafka-consumer.service.ts`
**Lines:** 22–92

### Correct
- `autoCommit: false` is correctly set (line 30), enabling manual offset management.
- Offset is committed after successful processing (line 63) and after DLQ (lines 77, 87).
- Partition-level pause/resume is used for backoff, preventing head-of-line blocking for other partitions.

### Blocker — CRITICAL: Infinite retry loop due to immutable retryCount
- **The consumer reads `retryCount` from the message payload but never increments it.**
  - *Location:* Line 56 (`const retryCount = payload.retryCount || 0;`) and lines 65–73 (retry branch).
  - *Behavior:* When a message fails:
    1. `retryCount` is always `0` (cron and backfill both set `retryCount: 0`).
    2. Condition `retryCount < maxRetries` (e.g., `0 < 3`) is **always true**.
    3. Partition pauses for `backoffMs`, resumes, and the function returns **without committing offset**.
    4. Kafka redelivers the **same uncommitted message** with the **same payload** (`retryCount` still `0`).
    5. Loop repeats **indefinitely** — the `else` branch (DLQ + commit) is **dead code** for all messages produced by this system.
  - *Impact:* A permanently failing message (e.g., ES timeout, bad payload, schema mismatch) **deadlocks the consumer partition**. No subsequent messages on that partition are processed. No DLQ is ever reached.
  - *Severity:* **CRITICAL** — this is a production outage risk for any failing timeline.

### Note
- The catch block does not rethrow after pause/resume; the sleep completes and the function exits, causing immediate redelivery after resume. This is technically correct for Kafka semantics (uncommitted offset), but combined with the immutable `retryCount`, it creates the infinite loop.

---

## 3. TimelineProcessorService — Pipeline Step Ordering & Latency

**File:** `src/modules/overlay-metrics-etl/kafka/timeline-processor.service.ts`
**Lines:** 93–156

### Correct
- Latency is executed as **step 6** in the 7-step ETL pipeline, after Platform, Device (3 dimensions), Transport, SDK, and Failures (lines 119–124).
- The entire pipeline is wrapped in a single `try/catch`, ensuring any failure throws to the consumer for retry/DLQ decision.
- `resolveInterval` correctly prioritizes explicit `intervalFrom`/`intervalTo` for backfill (lines 74–91).

### Blocker
- **Prior step failures skip latency entirely.** Because all steps run sequentially inside one `try/catch`, if any step before latency throws, `executeTimelinePipeline` exits immediately.
  - *Evidence:* UC-14 test (line 117) confirms: when SDK extraction fails, `extractLatency` and `loadLatency` are **never called**.
  - *Severity:* **High** — latency data is absent for any timeline where steps 1–5 fail, even transiently.

### Note
- Steps 1–5 are **not idempotent in terms of side effects** to MongoDB: each successful `loader.loadXxx()` persists data immediately via `repository.upsert()`. On retry, earlier steps re-execute and re-persist (accumulating `$inc` fields or overwriting `$set` fields), while the failing step and all subsequent steps (including latency) remain missing until the message eventually succeeds.

---

## 4. SchedulerConfigService — Target Loading & Validation

**File:** `src/modules/overlay-metrics-etl/scheduler/scheduler-config.service.ts`
**Lines:** 33–67

### Correct
- `getActiveTargets` correctly filters by `OVERLAY_METRICS_TENANT_ID` env var (lines 49–52).
- Validates tenant existence via `tenantCache.has(tenantId)` (lines 54–61).
- Falls back to returning `[]` when DB is unreachable, preventing cron crashes.

### Blocker
- **Silent failure on DB error masks operational issues.** Catching all DB errors and returning `[]` means a MongoDB connectivity problem makes the scheduler appear "healthy but with no targets" rather than failing visibly.
  - *Location:* Lines 42–47.
  - *Severity:* **Medium** — monitoring cannot detect scheduler-target DB outages.

### Note
- `SchedulerTargetSchema` does **not** have a database index on `enabled` (line 7 of schema file). Query `{ enabled: true }` performs a collection scan. For large `scheduler_targets` collections, this adds unnecessary load.
- No validation that `timelineIds` array is non-empty. A target with `timelineIds: []` passes validation and produces zero messages, silently.

---

## 5. Backfill Flow — MetricsApiService → JobProducerService → KafkaProducerService

**Files:**
- `src/modules/overlay-metrics-api/metrics-api.service.ts` (line 112)
- `src/modules/overlay-metrics-etl/kafka/job-producer.service.ts` (lines 53–76)
- `src/modules/overlay-metrics-etl/kafka/kafka-producer.service.ts` (lines 50–65)

### Correct
- Flow chain is clean: Controller → `MetricsApiService.triggerBackfill` → `JobProducerService.triggerBackfill` → `KafkaProducerService.sendJob`.
- `correlationId` is generated once per backfill request and propagated to all timeline messages, enabling traceability.
- Backfill messages carry `origin: 'backfill'` for differentiation.

### Blocker
- **Tenant ID override allows cross-tenant backfill.** `BackfillJobDto.tenantId` is **required** (not optional), yet `JobProducerService.triggerBackfill` uses `dto.tenantId || tenantId` (line 58). Since the DTO enforces `tenantId` to be present, the `|| tenantId` fallback is dead code. The header/path `tenantId` is **ignored** in favor of the DTO value, allowing a caller to backfill a different tenant than the one authenticated in the request.
  - *Location:* `job-producer.service.ts:58` and `backfill-job.dto.ts:12`.
  - *Severity:* **High** — potential unauthorized cross-tenant data write.

### Note
- No pre-flight validation that the effective tenant exists in `TenantCacheService` before producing. An invalid tenantId produces a Kafka message that will fail repeatedly in the consumer (hitting `TenantConnectionManager` "Tenant not found" error), triggering the infinite retry bug (Blocker #2).
- Backfill uses sequential `await` for each timeline, identical to cron. Large backfills with many timelines are slow to enqueue.

---

## 6. Root Cause: Why Backfill Recalc Does Not Create Latency Data

### Primary Cause: Broken Consumer Retry Logic + Pipeline All-or-Nothing Design

The most probable root cause for **missing latency records after backfill** is the combination of:

1. **Infinite retry loop in `KafkaConsumerService`** (Blocker #2).
   - If the latency extraction step fails for any reason (ES timeout, network blip, percentile computation overload), the entire timeline message throws.
   - The consumer enters `pause → sleep → resume` but `retryCount` never increments.
   - The same message is redelivered and fails again at the same step **forever**.
   - **Result:** The message offset is never committed; latency is never persisted; the partition is deadlocked.

2. **Latency is the most expensive ES query.**
   - `TrackingEsService.queryLatency` executes **8 top-level aggregations** (3 percentile sets, 3 stats, 2 additional percentile/stats for renderDuration) on `numeric_labels.receive_latency_ms`, `render_duration_ms`, and `ack_latency_ms`.
   - This is significantly heavier than the simple `terms` or `filters` aggregations used in earlier steps.
   - Under backfill load (potentially larger time ranges or concurrent backfill jobs), this query is the **most likely to timeout or throw**, making it the statistically dominant failure point that triggers the infinite retry loop.

3. **Pipeline partial persistence without compensation.**
   - Steps 1–5 (Platform through Failures) call `loader.loadXxx()` **before** latency runs. These writes are already committed to MongoDB.
   - On each retry iteration, steps 1–5 execute again and re-persist (accumulating counters via `$inc` or overwriting via `$set`).
   - Latency (step 6) never reaches `loadLatency`.
   - **Observed symptom:** Platform, Device, Transport, SDK, and Failure metrics exist in MongoDB; Latency is completely absent.

### Secondary Cause: Prior Step Failures Skip Latency

Even without the consumer retry bug, if any step **before** latency fails (e.g., `extractSdkVersions` throws), `executeTimelinePipeline` throws immediately and latency is **never reached** (confirmed by UC-14 spec test). This is by design for atomicity, but it means latency is absent whenever earlier steps are unstable.

### Additional Risk: No Latency-Specific Unique Key per Timeline

`metric-meta.ts` defines latency unique fields as `['tenantId', 'matchId', 'intervalFrom']` — `timelineId` is excluded. For a match with multiple timelines in the same interval, backfill messages for different timelines **overwrite** the same latency record rather than accumulating. This does not explain *missing* data, but it explains why backfill for multiple timelines might appear to "lose" latency data from earlier timelines.

---

## Summary of Severities

| # | Issue | File | Line | Severity |
|---|-------|------|------|----------|
| 1 | Infinite retry loop — `retryCount` never incremented | `kafka-consumer.service.ts` | 56, 65–73 | **CRITICAL** |
| 2 | Cron partial failure — no try/catch around `sendJob` | `job-producer.service.ts` | 38 | **High** |
| 3 | Cross-tenant backfill — DTO tenantId overrides auth tenant | `job-producer.service.ts` | 58 | **High** |
| 4 | Prior step failures skip latency | `timeline-processor.service.ts` | 93–156 | **High** |
| 5 | Silent DB failure in scheduler target loading | `scheduler-config.service.ts` | 42–47 | **Medium** |
| 6 | Missing `enabled` index on scheduler_targets | `scheduler-target.schema.ts` | 19 | **Low** |
| 7 | Sequential await in production loops | `job-producer.service.ts` | 35–50 | **Low** |

---

## Recommendations

1. **Fix infinite retry:** Track retry count in-memory by `(topic, partition, offset)` or republish the message with `retryCount + 1` before pausing. Alternatively, commit to DLQ after `maxRetries` distinct failure attempts.
2. **Wrap `sendJob` calls** in `handleCron` and `triggerBackfill` with individual try/catch + logging to ensure one failed produce does not abort the batch.
3. **Remove or reconcile `tenantId` override** in backfill: either make `dto.tenantId` optional and default to the authenticated tenant, or enforce that `dto.tenantId === tenantId`.
4. **Add `enabled` index** to `SchedulerTargetSchema` to avoid collection scans.
5. **Consider circuit breaker or separate try/catch for latency:** Given its query complexity, isolating latency in its own retry scope (or making the pipeline more granular) would prevent a single expensive aggregation from blocking the entire timeline.

---

*Note: The instruction to update `progress.md` was received, but per review-only agent guidelines, progress files are not modified during audit tasks. Findings are recorded in this audit document instead.*
