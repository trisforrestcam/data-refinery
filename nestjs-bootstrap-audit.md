# NestJS Bootstrap & Module Wiring Audit — data-refinery

> **Ngày audit:** 2026-05-15  
> **Phạm vi:** `src/main.ts`, `src/app.module.ts`, 4 config files, module wiring toàn app, và lý do latency pipeline không hoạt động.

---

## 1. src/main.ts

### Correct ✅
- **`ValidationPipe`** cấu hình đúng 3 flag bắt buộc theo convention:
  - `whitelist: true`
  - `forbidNonWhitelisted: true`
  - `transform: true`
- **Swagger** chỉ bật ở non-production (`env !== 'production'`), dùng `apiKey` scheme cho `x-tenant-id`.
- Có `app.enableShutdownHooks()` đúng chuẩn NestJS.

### Note ⚠️
- **Port fallback không nhất quán:**
  - `main.ts` dùng `configService.get<number>('app.port') || 5001`
  - `app.config.ts` default là `parseIntOrDefault(process.env.PORT, 3000)`
  - Nếu `PORT=0` (edge case), `main.ts` sẽ bind port `5001` thay vì `0` hoặc `3000`. Không phải lỗi nghiêm trọng nhưng gây confusion.

---

## 2. src/app.module.ts

### Correct ✅
- **Imports đầy đủ**, không thiếu module nào cần thiết cho bootstrap:
  - `ConfigModule.forRoot({ isGlobal: true, load: [app, mongo, kafka, elasticsearch] })`
  - `MongooseModule.forRootAsync` → main DB (dùng cho `TenantCacheService` và `SchedulerConfigService`)
  - `ScheduleModule.forRoot()` → enable `@Cron` cho `JobProducerService`
  - `ElasticsearchCoreModule` (Global) → ES client
  - `TenantCacheModule` (Global) → tenant config cache
  - `EtlModule`, `ApiModule`, `TenantManagementModule`
- **Không phát hiện circular dependency** trong dependency graph.

### Note ⚠️
- `EtlModule` import `KafkaModule` nhưng không `exports` gì. Vì `ApiModule` cũng import `KafkaModule` (để dùng `JobProducerService` và `SchedulerConfigService` cho backfill/scheduler-target API), `EtlModule` là **redundant** — xóa cũng không ảnh hưởng.

---

## 3. Config Files (`registerAs`)

### Correct ✅
- Cả 4 config (`app`, `mongo`, `kafka`, `elasticsearch`) đều dùng `registerAs` đúng pattern.
- `parseIntOrDefault` helper được dùng để parse số an toàn.

### Blocker 🚨
- **`src/config/elasticsearch.config.ts` — default `trackingIndex` sai:**
  ```ts
  trackingIndex: process.env.TRACKING_ES_INDEX || 'tracking-apm',
  ```
  Theo project convention và test `UC-18`, default phải là **`'tracking-events-*'`**.
  - **Evidence:** Test `UC-18-scheduler-config-defaults.spec.ts` line 210 fail:
    ```
    Expected: "tracking-events-*"
    Received: "tracking-apm"
    ```
  - Hệ quả: Nếu env var `TRACKING_ES_INDEX` không được set (hoặc `.env.local` set sai), toàn bộ ETL pipeline sẽ query nhầm index `tracking-apm`.

### Note ⚠️
- `kafka.config.ts` dùng `parseIntOrDefault` logic khác `app.config.ts` (không wrap `defaultValue` bằng `String()`). Vẫn đúng kết quả nhưng không nhất quán.

---

## 4. Module Wiring — Missing Imports & Dead Code

### Blocker 🚨
- **`MetricsApiModule` là dead code:**
  - File: `src/modules/overlay-metrics-api/metrics-api.module.ts`
  - Định nghĩa `MongooseModule.forFeature` cho cả 7 schemas + controller/service.
  - **Không được import ở bất kỳ đâu.** `AppModule` dùng `ApiModule` thay thế.
  - `ApiModule` import `PersistenceModule` (dùng `TenantModelFactory` + tenant connections) thay vì `MongooseModule.forFeature` trên main connection — đây là approach đúng cho multi-tenant.
  - **Khuyến nghị:** Xóa `metrics-api.module.ts` để tránh maintain 2 module gần giống nhau.

### Note ⚠️
- `ApiModule` import `KafkaModule` → read API phụ thuộc cả ETL pipeline (Extractor, Transformer, Loader, Kafka producer/consumer). Architecturally heavy nhưng functionally hoạt động.
- `RealtimeModule` (con của `ApiModule`) import `ExtractorModule` + `TransformerModule` để query ES trực tiếp. Đây là design choice hợp lý cho realtime endpoints (`/realtime/*`), nhưng làm `ApiModule` càng nặng thêm.

---

## 5. `MongooseModule.forRootAsync` (main DB) vs Tenant Connections (dynamic)

### Correct ✅
- **Không có conflict** giữa main connection và tenant connections.
  - Main connection: `MongooseModule.forRootAsync` trong `AppModule` → dùng cho `TenantCacheService` (`tenants` collection) và `SchedulerConfigService` (`scheduler_targets` collection).
  - Tenant connections: `TenantConnectionManager.createConnection(uri)` → dùng cho `OverlayMetricsRepository` (7 overlay metrics collections).

### Blocker 🚨
- **`TenantConnectionManager` dùng `autoIndex: false`:**
  ```ts
  const connection = createConnection(tenant.mongoUri, {
    maxPoolSize: 10,
    autoIndex: false,
  });
  ```
  **Hệ quả nghiêm trọng:** Tất cả schema indexes được định nghĩa trong `OverlayMetricsLatencySchema`, `OverlayMetricsPlatformSchema`, v.v. **KHÔNG BAO GIỜ được tạo trên tenant databases**.
  - Unique indexes (vd: `tenantId + matchId + intervalFrom` cho latency) không tồn tại.
  - TTL index trên `OverlayMetricsTimeseries` (`expireAfterSeconds: 7776000`) không tồn tại.
  - Performance indexes không tồn tại.
  - `PersistenceModule` đăng ký schemas trên main connection qua `MongooseModule.forFeature`, nhưng `OverlayMetricsRepository` **không bao giờ** dùng main connection models — hoàn toàn unused.

---

## 6. Lý do latency pipeline không hoạt động

### Root Cause #1 — Config & Index Mismatch 🚨
- `.env.local` set `TRACKING_ES_INDEX=tracking-apm`.
- `elasticsearch.config.ts` default cũng là `'tracking-apm'` thay vì `'tracking-events-*'`.
- **Vấn đề:** Index `tracking-apm` (APM traces) có thể chứa các field chung như `labels.platform`, `labels.stage`, `labels.browser`, `numeric_labels.render_duration_ms` — đủ để platform/device/transport/sdk/failure/timeseries pipeline hoạt động.
- Tuy nhiên, **latency query dùng 2 field chuyên biệt** mà APM index có thể không có:
  - `numeric_labels.receive_latency_ms`
  - `numeric_labels.ack_latency_ms`
- Elasticsearch `percentiles`/`stats` aggregation trên field không tồn tại trả về empty results (không throw), nên:
  - `transformLatency` nhận `aggregations` empty → return object toàn `0`.
  - `loadLatency` lưu document toàn `0` vào MongoDB.
  - API read trả về `[{ receive: { p50: 0, ... }, render: { p50: 0, ... }, ... }]` — từ góc nhìn user là "pipeline không hoạt động" vì data vô nghĩa.

### Root Cause #2 — Data Model Không Accumulate Across Timelines 🚨
- `metric-meta.ts`:
  ```ts
  [MetricType.LATENCY]: ['tenantId', 'matchId', 'intervalFrom'],
  [MetricType.LATENCY]: [], // Latency là percentiles — không thể cộng dồn
  ```
- Latency dùng `$set` toàn bộ (không `$inc`). Unique key là `tenantId + matchId + intervalFrom` — **không gồm `timelineId`**.
- Hệ quả: Nếu 1 match có nhiều timeline, mỗi timeline sẽ **overwrite** latency record của timeline trước. Khác với platform/device dùng `$inc` để accumulate, latency chỉ giữ data của timeline cuối cùng.

### Root Cause #3 — Missing Unique Index Trên Tenant DB 🚨
- Do `autoIndex: false` (Root Cause #5 ở trên), MongoDB tenant DB không có unique index trên `{ tenantId: 1, matchId: 1, intervalFrom: 1 }`.
- Khi có concurrent processing (nhiều partition Kafka hoặc multiple consumers), `updateOne` + `upsert: true` có thể insert **duplicate documents** thay vì update existing.
- Với latency dùng `$set`, duplicate documents gây query inconsistencies — API `find()` trả về nhiều rows cho cùng match+interval, hoặc `updateOne` chỉ update 1 trong nhiều duplicates.

### Tóm tắt causal chain
```
Sai default index ('tracking-apm') + env set sai index
    ↓
Latency ES query trên field không tồn tại → empty aggregations
    ↓
transformLatency → toàn 0
    ↓
loadLatency lưu meaningless data (hoặc bị overwrite/duplicate do thiếu unique index)
    ↓
API trả về [] hoặc [{...toàn 0...}] → user thấy "latency pipeline không hoạt động"
```

---

## Tổng kết Issues

| Mức độ | Issue | File | Dòng |
|--------|-------|------|------|
| **Blocker** | Default `trackingIndex` sai (`'tracking-apm'` thay vì `'tracking-events-*'`) | `src/config/elasticsearch.config.ts` | ~16 |
| **Blocker** | `autoIndex: false` trên tenant connections → missing tất cả indexes | `src/infrastructure/persistence/tenant-connection.manager.ts` | ~45 |
| **Blocker** | `MetricsApiModule` là dead code, không được import | `src/modules/overlay-metrics-api/metrics-api.module.ts` | toàn file |
| **Blocker** | Latency unique key không gồm `timelineId` → overwrite giữa các timelines | `src/infrastructure/persistence/metric-meta.ts` | ~11 |
| Note | Port fallback `5001` trong `main.ts` không nhất quán với config default `3000` | `src/main.ts` | ~8 |
| Note | `EtlModule` redundant vì `ApiModule` đã import `KafkaModule` | `src/modules/overlay-metrics-etl/etl.module.ts` | toàn file |
| Note | `PersistenceModule` đăng ký schemas trên main connection nhưng không dùng | `src/infrastructure/persistence/persistence.module.ts` | ~15-25 |

---

## Recommendations

1. **Sửa config default:**
   ```ts
   // src/config/elasticsearch.config.ts
   trackingIndex: process.env.TRACKING_ES_INDEX || 'tracking-events-*',
   ```

2. **Sửa `.env.local` hoặc production env:** Đảm bảo `TRACKING_ES_INDEX` trỏ đến index có đầy đủ latency fields (`tracking-events-*` hoặc tương đương).

3. **Bật index creation trên tenant DBs:**
   - Option A: Đổi `autoIndex: false` → `autoIndex: true` trong `TenantConnectionManager` (chấp nhận startup penalty lần đầu).
   - Option B: Tạo indexes thủ công qua migration/script, giữ `autoIndex: false` để tránh performance hit mỗi lần cold start.

4. **Xử lý latency multi-timeline:** Cân nhắc:
   - Thêm `timelineId` vào `UNIQUE_FIELDS[LATENCY]` nếu mỗi timeline cần record riêng.
   - Hoặc aggregate latency cross-timeline ở tầng Transformer trước khi persist (phức tạp hơn, cần merge percentile distributions).

5. **Dọn dead code:** Xóa `src/modules/overlay-metrics-api/metrics-api.module.ts`.
