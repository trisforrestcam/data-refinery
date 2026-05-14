# API Specification — Overlay Metrics Read API

> Read API cung cấp dữ liệu pre-aggregate từ MongoDB (không truy cập Elasticsearch trực tiếp).  
> Dữ liệu được làm mới mỗi **5 phút** bởi ETL pipeline (`extract-transform-load-metrics`).

---

## Base URL

| Environment | Base URL                       |
|-------------|--------------------------------|
| Production  | `https://<data-refinery-host>` |

Tất cả endpoints trong controller `MetricsApiController` được mount tại:

```
GET /metrics
```

> Không có prefix `/api/v1/overlay-metrics/`. Client gọi trực tiếp `/metrics/<endpoint>`.

---

## Authentication

Tất cả endpoints yêu cầu xác thực server-to-server qua **`InternalApiGuard`**.

### Cơ chế

- Guard đọc header `x-internal-api-key`.
- So sánh với giá trị `INTERNAL_API_KEY` trong environment (`process.env.INTERNAL_API_KEY`).
- Nếu env chưa được cấu hình **hoặc** header không khớp → trả về `401 Unauthorized`.

### Headers bắt buộc

| Header               | Bắt buộc | Mô tả                              |
|----------------------|----------|------------------------------------|
| `x-tenant-id`        | ✅ Có    | Tenant identifier                  |
| `x-internal-api-key` | ✅ Có    | Internal API key (không dùng Bearer token) |

> **Lưu ý:** Không sử dụng `Authorization: Bearer <token>`. Key phải được gửi nguyên văn qua header `x-internal-api-key`.

---

## Common Query Parameters

Tất cả 7 endpoints đều hỗ trợ bộ lọc query sau (định nghĩa trong `MetricsQueryDto`):

| Param        | Kiểu      | Bắt buộc | Mô tả                                                                   |
|--------------|-----------|----------|-------------------------------------------------------------------------|
| `matchId`    | `string`  | ❌ Không | Lọc theo Match ID                                                       |
| `timelineIds`| `string[]`| ❌ Không | Lọc theo 1 hoặc nhiều Timeline ID (truyền array hoặc single value)     |
| `from`       | `ISO 8601`| ❌ Không | Lọc `intervalFrom >= from`                                              |
| `to`         | `ISO 8601`| ❌ Không | Lọc `intervalFrom <= to`                                                |

### Ví dụ

```http
GET /metrics/platform?matchId=000000000000000000000000&from=2024-01-01T00:00:00Z&to=2024-01-02T00:00:00Z
```

---

## Endpoints

### 1. Platform Metrics

```http
GET /metrics/platform
```

**Mô tả:** Tỷ lệ nhận, render, lỗi theo platform. Dùng cho tab **"Tổng quan"**.

**Response:** `PlatformMetricDto[]`

| Field           | Kiểu      | Mô tả                              |
|-----------------|-----------|------------------------------------|
| `timelineId`    | `string`  | Timeline ID                        |
| `matchId`       | `string`  | Match ID                           |
| `tenantId`      | `string`  | Tenant ID                          |
| `platform`      | `string`  | Tên platform (e.g. `web`, `ios`)   |
| `sent`          | `number`  | Số event đã gửi                    |
| `received`      | `number`  | Số event đã nhận                   |
| `rendered`      | `number`  | Số event đã render thành công      |
| `failed`        | `number`  | Số event thất bại                  |
| `receiveRate`   | `number`  | Tỷ lệ nhận (`received / sent`)     |
| `renderRate`    | `number`  | Tỷ lệ render (`rendered / sent`)   |
| `failureRate`   | `number`  | Tỷ lệ lỗi (`failed / sent`)        |
| `netSuccessRate`| `number`  | Tỷ lệ thành công tổng thể          |
| `avgRenderMs`   | `number`  | Thờ gian render trung bình (ms)    |
| `intervalFrom`  | `Date`    | Bắt đầu interval                   |
| `intervalTo`    | `Date`    | Kết thúc interval                  |

**Sort mặc định:** `intervalFrom` DESC (mới nhất trước).

---

### 2. Device Breakdown

```http
GET /metrics/device
```

**Mô tả:** Phân bố ngườ dùng theo browser / OS / device class. Dùng cho tab **"Thiết bị"**.

**Response:** `DeviceBreakdownDto[]`

| Field          | Kiểu     | Mô tả                              |
|----------------|----------|------------------------------------|
| `timelineId`   | `string` | Timeline ID                        |
| `matchId`      | `string` | Match ID                           |
| `tenantId`     | `string` | Tenant ID                          |
| `dimension`    | `string` | Chiều phân tích (e.g. `browser`)   |
| `bucketKey`    | `string` | Giá trị bucket (e.g. `Chrome`)     |
| `received`     | `number` | Số event đã nhận                   |
| `rendered`     | `number` | Số event đã render                 |
| `failed`       | `number` | Số event thất bại                  |
| `renderRate`   | `number` | Tỷ lệ render                       |
| `avgRenderMs`  | `number` | Thờ gian render trung bình (ms)    |
| `intervalFrom` | `Date`   | Bắt đầu interval                   |
| `intervalTo`   | `Date`   | Kết thúc interval                  |

**Sort mặc định:** `intervalFrom` DESC.

---

### 3. Transport Comparison

```http
GET /metrics/transport
```

**Mô tả:** Hiệu suất WebSocket vs Long Polling. Dùng cho tab **"Transport"**.

**Response:** `TransportComparisonDto[]`

| Field          | Kiểu     | Mô tả                              |
|----------------|----------|------------------------------------|
| `timelineId`   | `string` | Timeline ID                        |
| `matchId`      | `string` | Match ID                           |
| `tenantId`     | `string` | Tenant ID                          |
| `transportMode`| `string` | `websocket` hoặc `long_polling`    |
| `count`        | `number` | Số lượng session                   |
| `renderRate`   | `number` | Tỷ lệ render                       |
| `avgRenderMs`  | `number` | Thờ gian render trung bình (ms)    |
| `p95RenderMs`  | `number` | P95 render latency (ms)            |
| `intervalFrom` | `Date`   | Bắt đầu interval                   |
| `intervalTo`   | `Date`   | Kết thúc interval                  |

**Sort mặc định:** `intervalFrom` DESC.

---

### 4. SDK Versions

```http
GET /metrics/sdk
```

**Mô tả:** Phân bố phiên bản SDK đang được sử dụng. Dùng cho tab **"SDK"**.

**Response:** `SdkVersionDto[]`

| Field          | Kiểu     | Mô tả                              |
|----------------|----------|------------------------------------|
| `timelineId`   | `string` | Timeline ID                        |
| `matchId`      | `string` | Match ID                           |
| `tenantId`     | `string` | Tenant ID                          |
| `sdkVersion`   | `string` | Phiên bản SDK (e.g. `3.2.1`)       |
| `count`        | `number` | Số lượng                           |
| `renderRate`   | `number` | Tỷ lệ render                       |
| `avgRenderMs`  | `number` | Thờ gian render trung bình (ms)    |
| `intervalFrom` | `Date`   | Bắt đầu interval                   |
| `intervalTo`   | `Date`   | Kết thúc interval                  |

**Sort mặc định:** `intervalFrom` DESC.

---

### 5. Failure Analysis

```http
GET /metrics/failures
```

**Mô tả:** Lý do lỗi × bước xảy ra lỗi. Dùng cho tab **"Lỗi"**.

**Response:** `FailureAnalysisDto[]`

| Field           | Kiểu     | Mô tả                              |
|-----------------|----------|------------------------------------|
| `timelineId`    | `string` | Timeline ID                        |
| `matchId`       | `string` | Match ID                           |
| `tenantId`      | `string` | Tenant ID                          |
| `failureReason` | `string` | Lý do lỗi                          |
| `failureStep`   | `string` | Bước xảy ra lỗi                    |
| `count`         | `number` | Số lượng lỗi                       |
| `percentOfFailed`| `number`| Tỷ lệ % trên tổng số lỗi           |
| `intervalFrom`  | `Date`   | Bắt đầu interval                   |
| `intervalTo`    | `Date`   | Kết thúc interval                  |

**Sort mặc định:** `intervalFrom` DESC.

---

### 6. Latency Percentiles

```http
GET /metrics/latency
```

**Mô tả:** P50/P75/P95/P99 cho receive, render, ack. Dùng cho tab **"Latency"**.

**Response:** `LatencyPercentileDto[]`

| Field             | Kiểu               | Mô tả                              |
|-------------------|--------------------|------------------------------------|
| `timelineId`      | `string`           | Timeline ID                        |
| `matchId`         | `string`           | Match ID                           |
| `tenantId`        | `string`           | Tenant ID                          |
| `receive`         | `PercentileSet`    | Percentiles nhận event             |
| `render`          | `PercentileSet`    | Percentiles render                 |
| `ack`             | `PercentileSet`    | Percentiles ack                    |
| `renderDuration`  | `RenderDurationSet`| Thờ gian render chi tiết           |
| `intervalFrom`    | `Date`             | Bắt đầu interval                   |
| `intervalTo`      | `Date`             | Kết thúc interval                  |

#### `PercentileSet`

| Field | Kiểu    | Mô tả |
|-------|---------|-------|
| `p50` | `number`| Median |
| `p75` | `number`| P75    |
| `p95` | `number`| P95    |
| `p99` | `number`| P99    |
| `avg` | `number`| Trung bình |
| `max` | `number`| Max    |

#### `RenderDurationSet`

| Field | Kiểu    | Mô tả |
|-------|---------|-------|
| `p50` | `number`| Median |
| `p95` | `number`| P95    |
| `p99` | `number`| P99    |
| `avg` | `number`| Trung bình |

**Sort mặc định:** `intervalFrom` DESC.

---

### 7. Timeseries

```http
GET /metrics/timeseries
```

**Mô tả:** Dữ liệu điểm theo thờ gian để vẽ biểu đồ xu hướng. Dùng cho biểu đồ thờ gian trên dashboard.

**Query Parameters (bổ sung):**

| Param    | Kiểu     | Bắt buộc | Mô tả                              |
|----------|----------|----------|------------------------------------|
| `metric` | `string` | ❌ Không | Lọc theo tên metric (e.g. `sent`, `received`, `rendered`, `failed`, `avgRenderMs`) |

**Response:** `TimeseriesPointDto[]`

| Field          | Kiểu     | Mô tả                              |
|----------------|----------|------------------------------------|
| `timelineId`   | `string` | Timeline ID                        |
| `matchId`      | `string` | Match ID                           |
| `tenantId`     | `string` | Tenant ID                          |
| `metric`       | `string` | Tên metric                         |
| `interval`     | `string` | Khoảng thờ gian aggregation        |
| `time`         | `Date`   | Thờ điểm dữ liệu                   |
| `value`        | `number` | Giá trị metric                     |
| `intervalFrom` | `Date`   | Bắt đầu interval                   |
| `intervalTo`   | `Date`   | Kết thúc interval                  |

**Sort mặc định:** `time` DESC.

---

## Error Responses

| Status | Mô tả                                                                 |
|--------|-----------------------------------------------------------------------|
| `400`  | Bad Request — Query params không hợp lệ (validation error)           |
| `401`  | Unauthorized — Thiếu hoặc sai `x-internal-api-key`                    |
| `403`  | Forbidden — `INTERNAL_API_KEY` chưa được cấu hình trên server         |

### Ví dụ lỗi 401

```json
{
  "statusCode": 401,
  "message": "Invalid or missing internal API key",
  "error": "Unauthorized"
}
```

---

## Notes

- Tất cả response được sort **DESC** theo `intervalFrom` (hoặc `time` với timeseries) để UI hiển thị dữ liệu mới nhất trước.
- API chỉ đọc từ MongoDB — không query Elasticsearch trực tiếp.
- Dữ liệu được pre-aggregate bởi ETL pipeline chạy mỗi 5 phút. Delay tối đa giữa event xảy ra và xuất hiện trên API là ~5 phút.
- Không có endpoint `GET /:matchId/funnel` trong controller hiện tại.
