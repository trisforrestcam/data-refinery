# DataRefinery — ETL Overlay Metrics Documentation

> **Goal:** Pre-aggregate tracking metrics từ Elasticsearch và persist vào MongoDB. Backend chỉ đọc từ MongoDB — fast, stable, scalable.

---

## 📚 Tài liệu

| File | Nội dung |
|------|----------|
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | Tài liệu kiến trúc chi tiết: ETL flow, ES queries, MongoDB indexes, env vars |
| [`01-overview.md`](01-overview.md) | Kiến trúc tổng quan, luồng dữ liệu, các collection MongoDB |
| [`02-es-aggregations.md`](02-es-aggregations.md) | Toàn bộ ES aggregation queries (100% logic tính toán ở ES) |
| [`03-mongo-schemas.md`](03-mongo-schemas.md) | MongoDB schemas + indexes cho pre-aggregated data |
| [`04-api-spec.md`](04-api-spec.md) | API specification — read-only từ MongoDB |
| [`05-implementation-guide.md`](05-implementation-guide.md) | Code chi tiết từng module (Extractor, Transformer, Loader, Scheduler) |
| [`06-transformer-dtos.md`](06-transformer-dtos.md) | DTO shapes sau khi transform |

---

## 🏗️ Kiến trúc

```
Scheduler (BullMQ every 5min)
    │
    ▼
Extractor ──ES Agg──▶ ES Cluster
    │
    ▼
Transformer (Map + Compute)
    │
    ▼
Loader ──bulkWrite/upsert──▶ MongoDB
    │
    ▼
Backend API (read-only)
```

---

## 🎯 Mục tiêu chính

1. **Đưa 100% logic query vào ES aggregation** — không xử lý ở backend
2. **Pre-aggregate rồi đẩy vào MongoDB** — API chỉ đọc, không tính toán
3. **Giảm tải ES cluster** — chỉ 1 query ES mỗi 5 phút thay vì mỗi user click
4. **Stable API latency** — MongoDB indexed query < 50ms thay vì 200ms–2s từ ES

---

## 📊 Các tab UI được hỗ trợ

| Tab | ES Aggregation | MongoDB Collection | API |
|-----|---------------|-------------------|-----|
| **Tổng quan** | `platform` terms + stage filters | `overlay_metrics_platform` | `GET /metrics/platform` |
| **Thiết bị** | `browser/os/device_class` terms | `overlay_metrics_device` | `GET /metrics/device` |
| **Transport** | `transport_mode` terms | `overlay_metrics_transport` | `GET /metrics/transport` |
| **SDK** | `sdk_version` terms | `overlay_metrics_sdk` | `GET /metrics/sdk` |
| **Lỗi** | `failure_reason` + `failure_step` terms | `overlay_metrics_failure` | `GET /metrics/failures` |
| **Thờ gian** | `date_histogram` + metric agg | `overlay_metrics_timeseries` | `GET /metrics/timeseries` |
| **Latency** | `percentiles` + `stats` | `overlay_metrics_latency` | `GET /metrics/latency` |

> **🔐 Auth:** Tất cả API endpoints đều yêu cầu header `x-internal-api-key` (do `InternalApiGuard` kiểm tra) và `x-tenant-id`.

---

## 🔧 Stack

- **Framework:** NestJS 11
- **Task Queue:** BullMQ v5 (`upsertJobScheduler`)
- **Database:** MongoDB (Mongoose 9)
- **Search:** Elasticsearch 9 (`@elastic/elasticsearch`)
- **Cache/Queue Backend:** Redis

---

## 🚀 Cách chạy

### 1. Cài dependencies

```bash
npm install
```

### 2. Config environment

```bash
cp .env.example .env
# Edit .env với ES tracking index, MongoDB URI, Redis config, INTERNAL_API_KEY
```

### 3. Start app

```bash
npm run start:dev
```

Scheduler sẽ tự động register job chạy mỗi 5 phút.

---

## 📈 Monitoring

| Metric | Cách đo | Ngưỡng cảnh báo |
|--------|---------|----------------|
| ETL latency | `intervalTo - processedAt` | > 10 phút |
| ES query time | `took` trong response | > 5 giây |
| Bulk write errors | Catch exception | > 0 |
| API p95 latency | Backend APM | > 100ms |

---

## 🔄 Migration Path

```
Phase 1: Xây ETL pipeline (platform + timeseries)
Phase 2: Thêm device + transport + SDK
Phase 3: Thêm latency + failures + heatmap
Phase 4: Backfill historical data
Phase 5: Dual-read (MongoDB first, ES fallback)
Phase 6: Cutover — xóa ES query logic khỏi backend
```

---

## 📝 Reference

- **Source project:** `/home/tris/vtvlive/internal/interactive-backend_v2`
- **Tracking module:** `src/report/tracking/`
- **Docs gốc:** `.agents/05-overlay-metrics.md`, `.agents/07-statistics.md`
- **ES tracking docs:** `.agents/explain/03-elasticsearch-tracking.md`
