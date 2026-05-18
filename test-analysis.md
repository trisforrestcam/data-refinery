# Test Analysis: Kafka Consumer & ETL Unit Tests

## 1. `test/unit/kafka-consumer.service.spec.ts`

### Overview
Tests the `KafkaConsumerService` which consumes messages from Kafka topic `overlay-metrics.etl.jobs`, delegates processing to `TimelineProcessorService`, and handles retry / DLQ logic.

### Mocked Data

#### Kafka Consumer (kafkajs)
- `connect`, `subscribe`, `run`, `pause`, `resume`, `commitOffsets`, `disconnect` are all mocked.
- `runMock` captures the `eachMessage` callback so tests can invoke it directly.

#### Dependencies
- `ConfigService` → returns `kafka.clientId`, `kafka.brokers`, `kafka.groupId`, `kafka.maxRetries=3`, `kafka.retryDelayMs=5000`.
- `TimelineProcessorService` → mock with `processTimeline: jest.fn()`.
- `KafkaProducerService` → mock with `sendJob: jest.fn()` and `sendToDLQ: jest.fn()`.

#### JobPayload helper (`createPayload`)
```ts
{
  version: 1,
  jobType: 'extract-transform-load-metrics',
  tenantId: 'tenant-001',
  matchId: 'match-123',
  timelineId: 'tl-001',
  timeRangeMinutes: 60,
  origin: 'scheduled',
}
```

### Test Cases

| # | Describe Block | Test Name | Expected Behavior | Assertion Checks |
|---|----------------|-----------|-------------------|------------------|
| 1 | `success flow` | `processTimeline được gọi và commitOffsets được gọi với offset+1` | On valid message, `processTimeline` runs once and offset is committed (+1). | `processTimeline` called 1×; `commitOffsets` called with offset `201` for partition 0. |
| 2 | `retry flow` | `processTimeline throw → republish with retryCount+1 and commitOffsets` | When `processTimeline` throws, message is republished via `sendJob` with `retryCount: 1`, then committed. | `sendJob` called 1× with `retryCount: 1`; `commitOffsets` with `301`; `pause` NOT called. |
| 3 | `retry flow` | `retryCount >= maxRetries → sendToDLQ được gọi và commitOffsets được gọi` | When incoming message already has `retryCount: 3` (>= maxRetries), error goes to DLQ instead of retry. | `sendToDLQ` called 1× with `timelineId: 'tl-001'` and error message `'ES timeout'`; `commitOffsets` with `401`; `pause` NOT called. |
| 4 | `parse error` | `JSON parse error → sendToDLQ được gọi và commitOffsets được gọi` | If message value is not valid JSON, DLQ immediately; `processTimeline` never called. | `processTimeline` NOT called; `sendToDLQ` called 1×; `commitOffsets` with `501`. |

### TimelineId Used
- Default payload uses **`timelineId: 'tl-001'`**.
- In retry/DLQ test, `timelineId: 'tl-001'` is asserted in the `sendToDLQ` call.

---

## 2. Other ETL / Timeline-related Unit Tests in `test/unit/`

### `test/unit/timeline-processor.service.spec.ts`
- **Scope:** Tests `TimelineProcessorService` which orchestrates 7 metric pipelines.
- **Mocked Data:** 7 `MetricPipeline` mocks (PLATFORM, DEVICE, TRANSPORT, SDK, FAILURE, LATENCY, TIMESERIES).
- **timelineId:** `tl-001`.
- **Key Tests:**
  1. `processTimeline gọi execute trên tất cả pipelines với đúng context` — all 7 pipelines executed once with correct `tenantId`, `matchId`, `timelineId`, `query.timelineIds`, `intervalFrom`, `intervalTo`.
  2. `1 pipeline fail → các pipeline khác vẫn chạy và throw tổng hợp` — SDK pipeline fails; others still run; throws `'tl-001 failed pipelines: sdk'`.
  3. `payload không hợp lệ → throw error` — empty payload throws `'Invalid timeline payload'`.
  4. `resolveInterval từ explicit intervalFrom/intervalTo` — explicit ISO strings passed through to pipeline context.

### `test/unit/job-producer.service.spec.ts`
- **Scope:** Tests cron-triggered job production and backfill API.
- **Mocked Data:** `SchedulerConfigService` returns active targets; `KafkaProducerService` mock.
- **Key Tests:**
  1. `2 targets với 3 timelines mỗi target → 6 sendJob calls` — verifies fan-out: each timeline becomes one Kafka message with `origin: 'scheduled'` and `timeRangeMinutes: 60`.
  2. `0 targets → không gọi sendJob và log warning` — no messages produced when no active targets.
  3. `1 target với 1 timeline → 1 sendJob call` — single message produced.
  4. `dto với 2 timelineIds → 2 sendJob calls với origin=backfill và trả về correlationId` — backfill produces 2 messages sharing the same `correlationId`.

### `test/unit/kafka-producer.service.spec.ts`
- **Scope:** Tests `KafkaProducerService` message serialization.
- **Mocked Data:** Mocked kafkajs `Producer` (`connect`, `send`, `disconnect`).
- **timelineId:** `tl-001`, `tl-002`, `tl-003`.
- **Key Tests:**
  1. `sendJob` — message sent to `overlay-metrics.etl.jobs` with key `tenantId|matchId|timelineId` and JSON value containing `version: 1`, `jobType: 'extract-transform-load-metrics'`.
  2. `sendJob` with full payload — asserts all optional fields (`intervalFrom`, `intervalTo`, `retryCount`, `origin`, `correlationId`) are serialized.
  3. `sendToDLQ` — message sent to `overlay-metrics.etl.dlq` with `errorMessage`, `errorStack`, `failedAt`, `tenantId`, `timelineId`.

---

## 3. Additional ETL-related Spec Outside `test/unit/`

### `src/modules/overlay-metrics-etl/transformer/transformer.service.spec.ts`
- **Scope:** Tests `TransformerService` (pure functions, no NestJS TestModule).
- **timelineId:** `tl-001` (used in `TransformContext`).
- **Key Tests:**
  1. Platform metrics transformation (including zero-sent edge case).
  2. Device breakdown (`browser` dimension).
  3. Transport comparison (with `p95RenderMs`).
  4. SDK versions.
  5. Failure analysis (splits by reason + step, calculates `percentOfFailed`).
  6. Latency percentiles (receive, render, ack, renderDuration).
  7. Timeseries (`sent` metric, `5m` interval).
  8. Empty aggregations → empty arrays for all transforms.

---

## Summary of Timeline IDs Across Tests

| File | TimelineId(s) |
|------|---------------|
| `kafka-consumer.service.spec.ts` | `tl-001` |
| `timeline-processor.service.spec.ts` | `tl-001` |
| `job-producer.service.spec.ts` | `tl-1`..`tl-7`, `tl-backfill-1`, `tl-backfill-2` |
| `kafka-producer.service.spec.ts` | `tl-001`, `tl-002`, `tl-003` |
| `transformer.service.spec.ts` | `tl-001` (in context) |
