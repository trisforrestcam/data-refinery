# Kafka ETL Flow: Cron → Producer → Consumer → Processor

## Files Read

1. `src/modules/overlay-metrics-etl/kafka/job-producer.service.ts` (full)
2. `src/modules/overlay-metrics-etl/kafka/kafka-producer.service.ts` (full)
3. `src/modules/overlay-metrics-etl/kafka/kafka-consumer.service.ts` (full)
4. `src/modules/overlay-metrics-etl/kafka/timeline-processor.service.ts` (full)
5. `src/modules/overlay-metrics-etl/scheduler/scheduler-config.service.ts` (full)
6. `src/modules/overlay-metrics-etl/pipelines/pipeline.context.ts` (full)
7. `src/infrastructure/persistence/overlay-metrics.repository.ts` (full)
8. `src/infrastructure/persistence/metric-meta.ts` (full)
9. `src/domain/schemas/overlay-metrics-*.schema.ts` (grep for `timelineId`)
10. `src/modules/overlay-metrics-api/dto/backfill-job.dto.ts` (full)

---

## End-to-End Flow

### 1. Cron Trigger — `JobProducerService.handleCron()`
- **File:** `src/modules/overlay-metrics-etl/kafka/job-producer.service.ts`
- **Trigger:** `@Cron('0 * * * *')` — runs at minute 0 of every hour.
- **Logic:**
  1. Calls `SchedulerConfigService.getActiveTargets()` to read enabled targets from MongoDB collection `scheduler_targets`.
  2. Filters targets against `TenantCacheService` (skips if tenant not active).
  3. For each target, iterates over `target.timelineIds`.
  4. Calls `KafkaProducerService.sendJob()` **once per timeline**.
  5. Each message carries:
     - `tenantId`, `matchId`, `timelineId`
     - `timeRangeMinutes: 60`
     - `origin: 'scheduled'`, `retryCount: 0`, `scheduledAt: ISO string`

### 2. Producer — `KafkaProducerService.sendJob()`
- **File:** `src/modules/overlay-metrics-etl/kafka/kafka-producer.service.ts`
- **Topic:** `overlay-metrics.etl.jobs`
- **Partition key:** `` `${payload.tenantId}|${payload.matchId}|${payload.timelineId}` ``
  - Guarantees ordering for the same tenant+match+timeline combination.
- **DLQ:** `sendToDLQ()` publishes to the topic configured at `kafka.dlqTopic` with `errorMessage`, `errorStack`, `failedAt`.

### 3. Consumer — `KafkaConsumerService`
- **File:** `src/modules/overlay-metrics-etl/kafka/kafka-consumer.service.ts`
- **Setup:** Raw KafkaJS consumer, `autoCommit: false`, manual offset commit.
- **Per-message flow (`handleMessage`):**
  1. Parse JSON → `JobPayload`.
  2. Parse failure → send to DLQ + commit offset (poison pill handling).
  3. Call `TimelineProcessorService.processTimeline(payload)`.
  4. **Success:** commit offset (`offset + 1`).
  5. **Failure:**
     - If `retryCount < maxRetries` (default from config):
       - Compute exponential backoff: `retryDelayMs * 2^retryCount`.
       - Republish via `sendJob({ ...payload, retryCount: retryCount + 1 })`.
       - Commit original offset (at-least-once semantics).
     - If exhausted:
       - Send to DLQ.
       - Commit offset.

### 4. Processor — `TimelineProcessorService.processTimeline()`
- **File:** `src/modules/overlay-metrics-etl/kafka/timeline-processor.service.ts`
- **Validation:** Ensures `tenantId`, `matchId`, `timelineId`, `timeRangeMinutes` are present and valid.
- **Interval resolution (`resolveInterval`):**
  - If `intervalFrom`/`intervalTo` present (backfill) → use them.
  - Otherwise compute from `now`, rounded down to multiples of `timeRangeMinutes`.
- **Execution (`executeTimelinePipeline`):**
  - Builds `PipelineContext`:
    ```ts
    {
      tenantId, matchId, timelineId, intervalFrom, intervalTo,
      query: { timelineIds: [timelineId], tenantId, from: intervalFrom, to: intervalTo }
    }
    ```
  - Runs all injected `MetricPipeline[]` in parallel via `Promise.all`.
  - Error isolation: one pipeline failure does not crash others; aggregated error thrown at end.

---

## How `timelineId` Flows Through the System

| Stage | Role of `timelineId` | Notes |
|---|---|---|
| **Scheduler DB** | `scheduler_targets.timelineIds: string[]` | Each target (match) can have multiple timelines. |
| **JobPayload** | Required string field. | Defined in `kafka-producer.service.ts`. |
| **Kafka Key** | Part of partition key: `tenantId\|matchId\|timelineId` | Ensures per-timeline ordering. |
| **Consumer logs** | Logged in retry / DLQ messages. | `Timeline ${payload.timelineId} failed (retry …)` |
| **Processor validation** | Mandatory field; missing → throws. | `validatePayload()` rejects if absent. |
| **PipelineContext** | Passed into every pipeline. | Used to build ES `TrackingAggQuery.timelineIds: [timelineId]`. |
| **Extractor (ES)** | Filters ES aggregations to 1 timeline. | Query scoped to single timeline. |
| **MongoDB schemas** | Stored as `@Prop({ required: true })` in all 7 collections. | Present in Platform, Device, Transport, SDK, Failure, Timeseries, Latency. |
| **Upsert / unique key** | **NOT part of the unique key.** | `metric-meta.ts` explicitly says unique fields use `matchId` (not `timelineId`) to accumulate data across timelines. |
| **Upsert behavior** | `$set` on every upsert. | If multiple timelines for same `matchId + intervalFrom` are processed, `timelineId` in MongoDB reflects the **last processed timeline**. |

### Important Design Decision
The system intentionally accumulates data from **multiple timelines into the same MongoDB record** for a given `matchId + interval`. The `timelineId` field is stored for observability but is **overwritten** on each upsert. This is documented in `overlay-metrics-latency.schema.ts`:

> `timelineId` không nằm trong unique key … Khi nhiều timeline cùng match và interval được xử lý, field này phản ánh **timeline cuối cùng**.

This applies to all metric types because `metric-meta.ts` defines `UNIQUE_FIELDS` without `timelineId` for every `MetricType`.

---

## Backfill Path

`JobProducerService.triggerBackfill()` (invoked by API) follows the same producer logic:
- Accepts `BackfillJobDto` with explicit `intervalFrom` / `intervalTo`.
- Publishes one message per `timelineId` with `origin: 'backfill'` and a `correlationId`.
- Consumer and processor handle it identically to scheduled jobs.

---

## Retry & DLQ Summary

| Config key | Purpose |
|---|---|
| `kafka.maxRetries` | Max republish attempts before DLQ. |
| `kafka.retryDelayMs` | Base delay; actual = `base * 2^retryCount`. |
| `kafka.dlqTopic` | Dead-letter topic for permanently failed timelines. |

All retries are **re-published as new Kafka messages**; the original message is committed. This means:
- Retries may be processed by a different consumer instance.
- Ordering is preserved per partition key (same timeline).
- There is no in-memory retry state.
