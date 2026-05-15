# Test Coverage Audit: Latency Pipeline

> **Ngày audit:** 2026-05-15
> **Phạm vi:** `data-refinery` — ETL pipeline và Read API cho overlay metrics, tập trung vào **latency pipeline** (receive/render/ack/renderDuration percentiles).

---

## 1. Tóm tắt test hiện có liên quan đến latency

### 1.1. Các file test chuyên biệt về latency

| File | Số test latency | Mức độ coverage |
|------|-----------------|-----------------|
| `test/use-cases/UC-07-latency-percentile.spec.ts` | 3 | ES query shape + transform + edge case null |
| `src/modules/overlay-metrics-etl/transformer/transformer.service.spec.ts` | 1 | Transform cơ bản (happy path + empty agg) |

**Tổng cộng:** Chỉ có **4 test cases** trong toàn bộ codebase chạm trực tiếp đến latency logic.

### 1.2. Các file test gián tiếp chạm latency

| File | Latency được test ở mức nào | Ghi chú |
|------|---------------------------|---------|
| `UC-01-full-etl-pipeline.spec.ts` | Mock — kiểm tra `extractLatency`, `transformLatency`, `loadLatency` được gọi đúng 1 lần | Không verify dữ liệu thật qua Repository |
| `UC-09-empty-window.spec.ts` | Mock — kiểm tra loader early return khi array rỗng | Không verify `bulkWrite` cho latency với data thật |
| `UC-10-partial-data.spec.ts` | Mock — kiểm tra normalize NaN/null về 0 cho latency | Processor mock loader, không chạy Repository thật |
| `UC-14-pipeline-partial-failure.spec.ts` | Mock — kiểm tra state commit khi pipeline fail | `mongoState.latency` là mock array, không phải DB |
| `UC-17-es-v9-query-shape.spec.ts` | Query shape — verify `queryLatency` gửi đúng aggs | Không chạm transform/load |
| `test/unit/timeline-processor.service.spec.ts` | Mock — verify thứ tự gọi latency trong pipeline | Không verify persistence |

---

## 2. Phân tích chi tiết từng khối

### 2.1. UC-07-latency-percentile.spec.ts

**Đã test:**
- ES query có đủ `percentiles` (p50/p75/p95/p99) và `stats` cho receive, render, ack (test 1).
- `transformLatency` map đúng values, `renderDuration.avg` lấy từ `render_stats.avg` (test 2).
- Edge case: thiếu keys hoặc null thì default về 0 (test 3).

**Chưa test:**
- ❌ **LoaderService/Repository**: Không có dòng nào verify `loadLatency` hoặc `OverlayMetricsRepository.upsert` được gọi.
- ❌ **TenantModelFactory**: Không test model lookup cho `MetricType.LATENCY`.
- ❌ **bulkWrite ops**: Không verify cấu trúc `updateOne` filter/update cho latency.
- ❌ **Idempotency**: Không test rerun cùng interval cho latency.

### 2.2. transformer.service.spec.ts

**Đã test:**
- `transformLatency` happy path (dòng ~130–180).
- `transformLatency` với empty aggregations trả về object all-zeros (trong test "empty aggregations").

**Chưa test:**
- ❌ **Fallback `renderDuration.avg`**: Không có test cho path `render_duration_stats?.avg ?? render_stats?.avg` (code tại `transformer.service.ts:238`).
- ❌ **Rounding edge cases**: Giá trị percentile rất nhỏ/rất lớn, negative values.
- ❌ **Missing `render_duration` hoàn toàn**: Chỉ test `{}` cho toàn bộ aggregations, không test thiếu riêng `render_duration`.

### 2.3. UC-14-pipeline-partial-failure.spec.ts

**Đã test:**
- Behavior khi fail ở step 2 (Device), step 4 (SDK), step 7 (Timeseries).
- Step 6 (Latency) luôn chạy trước Timeseries nên được kiểm tra gián tiếp ở scenario "fail step 7".

**Chưa test:**
- ❌ **Fail tại step 6 (Latency)**: Không có scenario `extractLatency` throw error. Nếu latency fail, cần verify platform/device/transport/sdk/failures đã commit và timeseries không chạy.
- ❌ **Fail tại `loadLatency`**: Không test trường hợp `OverlayMetricsRepository.upsert` throw (ví dụ: MongoDB network error).

### 2.4. UC-09-empty-window.spec.ts

**Đã test:**
- Loader early return cho latency khi array rỗng.
- Processor hoàn thành khi ES trả empty aggregations, và `loadLatency` được gọi với 1 item all-zeros.

**Chưa test:**
- ❌ Không verify latency record thực sự được upsert với all-zeros vào MongoDB (chỉ mock loader).

### 2.5. UC-12-mongodb-duplicate-key.spec.ts

**Đã test:**
- Duplicate key cho Platform (test 1).
- Upsert idempotent cho Platform và Device (test 2, 3).

**Chưa test:**
- ❌ **Duplicate key cho Latency**: `UNIQUE_FIELDS[LATENCY]` = `['tenantId', 'matchId', 'intervalFrom']`. Nếu bulkWrite throw `MongoServerError` code 11000 cho latency, behavior chưa được test.
- ❌ **Idempotent rerun cho Latency**: `INC_FIELDS[LATENCY] = []`, nên latency hoàn toàn dùng `$set`. Nếu rerun, giá trị mới sẽ ghi đè — cần test để đảm bảo `$inc` không bị inject sai.

### 2.6. UC-13-idempotent-rerun.spec.ts

**Đã test:**
- Rerun accumulate cho Platform (sent/received/rendered/failed cộng dồn, derived metrics ghi đè).
- Platform mới được thêm vào mà không ảnh hưởng doc cũ.

**Chưa test:**
- ❌ **Latency idempotent rerun**: Latency DTO là single object (không phải array of buckets như platform). Cần verify rerun ghi đè đúng nested percentiles.

---

## 3. Tìm kiếm integration test end-to-end

### Kết quả:
- `test/integration/` — **thư mục rỗng**.
- `test/e2e/` — **thư mục rỗng**.
- `test/app.e2e-spec.ts` — Chỉ có test default `"Hello World!"`, không liên quan.

**Kết luận:** Không có **bất kỳ integration test nào** test latency ETL từ ES query → Transformer → Loader → Repository → MongoDB upsert.

---

## 4. Tests cho TenantModelFactory / TenantConnectionManager / OverlayMetricsRepository với latency

### Kết quả tìm kiếm:

| Component | Có test latency? | Evidence |
|-----------|-----------------|----------|
| `TenantModelFactory` | ❌ **Không** | `UC-09`, `UC-12`, `UC-13` dùng mock `TenantModelFactory`, không test latency model |
| `TenantConnectionManager` | ❌ **Không** | Không có test file riêng, chưa được test với latency connection |
| `OverlayMetricsRepository` | ❌ **Không** | `UC-12` test platform/device duplicate key + upsert ops, nhưng **không test latency** |
| `metric-meta.ts` `INC_FIELDS[LATENCY]` | ❌ **Không** | Chưa có test xác nhận latency dùng `$set` (không `$inc`) |

---

## 5. Test Gaps (khoảng trống nghiêm trọng)

### 🔴 Blocker / High Risk

1. **Không có end-to-end latency test qua Repository**
   - Nếu `OverlayMetricsRepository.buildUpsertOps` xử lý sai với `INC_FIELDS[LATENCY] = []` (ví dụ: tạo ra `$inc: {}` hoặc omit `$set`), latency sẽ không được lưu đúng.
   - Nếu `TenantModelFactory.getModelByType` lookup sai schema cho `MetricType.LATENCY`, data sẽ vào collection/platform sai.

2. **Không test idempotent rerun cho latency**
   - Latency khác platform: không có `$inc`. Nếu rerun, `$set` phải ghi đè toàn bộ nested percentiles. Nếu logic `$inc` bị áp dụng nhầm, MongoDB sẽ tạo ra field số bị cộng dồn sai (ví dụ: `receive.p50` tăng vô hạn).

3. **Không test pipeline fail tại step latency**
   - Nếu `extractLatency` throw hoặc `loadLatency` throw, toàn bộ pipeline dừng. Cần verify data của steps trước (platform, device, transport, sdk, failures) vẫn được giữ nguyên, và timeseries không chạy.

4. **Không test duplicate key cho latency collection**
   - Unique index latency là `{ tenantId, matchId, intervalFrom }`. Nếu bulkWrite throw 11000, processor phải propagate lỗi để Kafka retry. Chưa được verify.

### 🟡 Medium Risk

5. **Không test Read API cho latency**
   - `UC-19-read-api.spec.ts` test platform, device, transport, timeseries, failures nhưng **không test latency endpoint**.
   - Nếu controller/service bỏ sót `getLatency` hoặc filter sai, UI không đọc được data.

6. **Không test schema validation cho latency nested objects**
   - `OverlayMetricsLatencySchema` yêu cầu `receive`, `render`, `ack` là `PercentileSet` (6 fields required), `renderDuration` là `RenderDurationSet` (4 fields required). Nếu transformer bỏ sót field, MongoDB sẽ reject insert. Chưa có test bắt lỗi này.

7. **Không test `renderDuration.avg` fallback path**
   - Code: `aggregations?.render_duration_stats?.avg ?? aggregations?.render_stats?.avg`. Chưa test khi `render_duration_stats` missing.

8. **Không test latency với real `TenantConnectionManager` + in-memory MongoDB**
   - Tất cả test đều mock `TenantModelFactory`. Chưa có test integration với MongoDB thật (hoặc `mongodb-memory-server`).

---

## 6. Đề xuất tests cần thêm

### 6.1. UC mới: End-to-end latency persistence (Ưu tiên cao nhất)

```
test/use-cases/UC-20-latency-end-to-end-persistence.spec.ts
```

**Mục tiêu:** Verify latency data đi từ `TrackingEsService.queryLatency` → `TransformerService.transformLatency` → `LoaderService.loadLatency` → `OverlayMetricsRepository.upsert` → `TenantModelFactory.getModelByType(MetricType.LATENCY)` → `bulkWrite` với đúng ops.

**Test cases:**
1. Happy path: ES trả đầy đủ percentiles + stats → bulkWrite tạo đúng `updateOne` với filter `{ tenantId, matchId, intervalFrom }`, update có `$set` (không có `$inc` vì `INC_FIELDS[LATENCY] = []`), `$setOnInsert: { createdAt }`, `$currentDate: { updatedAt }`.
2. Rerun cùng interval: bulkWrite lần 2 vẫn dùng `$set` để ghi đè toàn bộ nested objects (`receive`, `render`, `ack`, `renderDuration`).
3. Missing nested fields: Nếu transformer trả DTO thiếu `ack.p95`, verify MongoDB schema reject hoặc normalize về 0 (tùy behavior mong muốn).

### 6.2. UC mới: Pipeline partial failure tại latency step

```
Bổ sung vào UC-14 hoặc tạo UC-21-pipeline-fail-at-latency.spec.ts
```

**Test cases:**
1. `extractLatency` throw → verify platform/device/transport/sdk/failures đã commit, latency chưa commit, timeseries chưa chạy.
2. `loadLatency` throw (MongoDB network error) → verify tương tự, error được propagate.

### 6.3. UC mới: Latency duplicate key handling

```
Bổ sung vào UC-12 hoặc tạo UC-22-latency-duplicate-key.spec.ts
```

**Test cases:**
1. `bulkWrite` latency throw `MongoServerError` code 11000 → verify error propagate lên `TimelineProcessorService`.
2. Upsert latency 2 lần cùng `{ tenantId, matchId, intervalFrom }` → lần 2 chỉ update (`matchedCount: 1`), không insert mới.

### 6.4. Bổ sung transformer tests

```
Bổ sung vào transformer.service.spec.ts
```

**Test cases:**
1. `renderDuration.avg` fallback từ `render_stats.avg` khi `render_duration_stats` missing.
2. `renderDuration.avg` lấy từ `render_duration_stats.avg` khi cả 2 đều có (ưu tiên `render_duration_stats`).
3. Negative percentile values (edge case từ ES).

### 6.5. Bổ sung Read API test

```
Bổ sung vào UC-19-read-api.spec.ts
```

**Test cases:**
1. `GET /metrics/latency` với `x-tenant-id` + `MetricsQueryDto` → verify `OverlayMetricsRepository.find(tenantId, MetricType.LATENCY, filter)` được gọi.
2. Filter kết hợp `matchId` + `from/to` cho latency.

### 6.6. Integration test với mongodb-memory-server (Optional, long-term)

```
test/integration/latency-pipeline.integration.spec.ts
```

**Test cases:**
1. Chạy full pipeline với `mongodb-memory-server`, verify latency document được insert và read back đúng nested structure.
2. Verify TTL index trên `intervalFrom` (90 ngày) cho latency collection.

---

## 7. Tổng kết

| Tiêu chí | Trạng thái |
|----------|-----------|
| ES query shape (latency) | ✅ Được test (UC-07, UC-17) |
| Transform latency | ✅ Được test cơ bản (UC-07, transformer.spec.ts) |
| LoaderService.loadLatency | ⚠️ Mock-only, chưa verify với Repository |
| Repository.upsert latency | ❌ **Không được test** |
| TenantModelFactory latency | ❌ **Không được test** |
| Pipeline fail tại latency | ❌ **Không được test** |
| Idempotent rerun latency | ❌ **Không được test** |
| Duplicate key latency | ❌ **Không được test** |
| Read API latency | ❌ **Không được test** |
| End-to-end ES → MongoDB | ❌ **Không có integration test** |

**Khuyến nghị:** Ưu tiên viết **UC-20 (end-to-end latency persistence)** và **bổ sung scenario fail tại latency vào UC-14** để bắt lỗi nếu latency không được lưu hoặc bị lưu sai.
