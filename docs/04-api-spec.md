# API Specification — Read from MongoDB

> Các API này được **interactive-backend_v2** (hoặc các backend khác) gọi để lấy dữ liệu overlay metrics. **100% read-only từ MongoDB**, không query ES.

## Base URL

```
GET /api/v1/overlay-metrics/...
```

## Headers

| Header | Bắt buộc | Mô tả |
|--------|----------|-------|
| `Authorization` | ✅ | Bearer token |
| `X-TENANT-ID` | ✅ | Tenant identifier |
| `X-TRACE-ID` | ❌ | Distributed tracing (optional) |

---

## 1. Platform Metrics (Tổng quan)

### `GET /:matchId/platform-metrics`

Lấy metrics tổng hợp theo platform cho một match.

**Query params:**

| Param | Type | Required | Mô tả |
|-------|------|----------|-------|
| `from` | ISO string | ❌ | Lọc từ thờ gian |
| `to` | ISO string | ❌ | Lọc đến thờ gian |
| `platform` | string | ❌ | Lọc platform cụ thể |

**Response (`PlatformMetricDto[]`):**

```json
[
  {
    "platform": "android",
    "sent": 1000,
    "received": 950,
    "rendered": 920,
    "failed": 30,
    "receiveRate": 95.0,
    "renderRate": 92.0,
    "failureRate": 3.16,
    "avgRenderMs": 125.5
  }
]
```

**MongoDB Query:**

```typescript
this.platformModel.find({
  matchId,
  tenantId,
  ...(from && to ? { intervalFrom: { $gte: new Date(from) }, intervalTo: { $lte: new Date(to) } } : {}),
  ...(platform ? { platform } : {})
}).lean();
```

---

## 2. Device Breakdown (Thiết bị)

### `GET /:matchId/device-breakdown`

**Query params:**

| Param | Type | Required | Mô tả |
|-------|------|----------|-------|
| `dimension` | string | ❌ | `browser` (default) \| `os` \| `deviceClass` |
| `from` | ISO string | ❌ | |
| `to` | ISO string | ❌ | |

**Response (`DeviceBreakdownDto[]`):**

```json
[
  {
    "dimension": "Chrome",
    "received": 5000,
    "rendered": 4800,
    "failed": 200,
    "renderRate": 96.0,
    "avgRenderMs": 45.5
  }
]
```

---

## 3. Transport Comparison (Transport)

### `GET /:matchId/transport-comparison`

**Response (`TransportComparisonDto[]`):**

```json
[
  {
    "transportMode": "wsInteractive",
    "count": 8000,
    "renderRate": 94.5,
    "avgRenderMs": 42.0,
    "p95RenderMs": 85.0
  }
]
```

---

## 4. SDK Versions (SDK)

### `GET /:matchId/sdk-versions`

**Response (`SdkVersionDto[]`):**

```json
[
  {
    "sdkVersion": "v2.1.0",
    "count": 7,
    "renderRate": 66.67,
    "avgRenderMs": 92.0
  }
]
```

---

## 5. Failure Analysis (Lỗi)

### `GET /:matchId/failures`

**Response (`FailureAnalysisDto[]`):**

```json
[
  {
    "failureReason": "timeout",
    "failureStep": "render",
    "count": 150,
    "percentOfFailed": 75.0
  }
]
```

---

## 6. Timeseries (Thờ gian)

### `GET /:matchId/timeseries`

**Query params:**

| Param | Type | Required | Mô tả |
|-------|------|----------|-------|
| `metric` | string | ❌ | `sent` (default) \| `received` \| `rendered` \| `failed` \| `avgRenderMs` |
| `interval` | string | ❌ | `5m` (default) \| `1m` \| `1h` \| `1d` |
| `from` | ISO string | ❌ | |
| `to` | ISO string | ❌ | |

**Response (`TimeseriesPointDto[]`):**

```json
[
  { "time": "2024-01-15T10:00:00Z", "value": 150 },
  { "time": "2024-01-15T10:05:00Z", "value": 200 }
]
```

---

## 7. Latency Percentiles

### `GET /:matchId/latency`

**Response (`LatencyPercentileDto`):**

```json
{
  "receive": { "p50": 20, "p75": 30, "p95": 50, "p99": 80, "avg": 25, "max": 100 },
  "render": { "p50": 30, "p75": 45, "p95": 70, "p99": 100, "avg": 35, "max": 150 },
  "ack": { "p50": 5, "p75": 10, "p95": 15, "p99": 20, "avg": 7, "max": 25 },
  "renderDuration": { "p50": 30, "p95": 70, "p99": 100, "avg": 35 }
}
```

---

## 8. Match Funnel (Tổng hợp)

### `GET /:matchId/funnel`

Trả về funnel tổng hợp cho toàn bộ match + per-question breakdown.

**Response (`MatchFunnelDto`):**

```json
{
  "sent": 10000,
  "received": 9500,
  "rendered": 9200,
  "failed": 300,
  "receiveRate": 95.0,
  "renderRate": 92.0,
  "failureRate": 3.16,
  "netSuccessRate": 92.0,
  "matchId": "match001",
  "questionCount": 5,
  "questions": [
    {
      "timelineId": "t1",
      "sent": 2000,
      "received": 1900,
      "rendered": 1850,
      "receiveRate": 95.0,
      "renderRate": 92.5
    }
  ]
}
```

**Implementation note:** Funnel tổng hợp có thể được tính bằng cách aggregate từ `overlay_metrics_platform` collection (sum các platform lại), không cần query ES.

---

## Error Responses

| Status | Mô tả |
|--------|-------|
| `400` | Missing required params (matchId, tenantId) |
| `404` | Match không có data (timelineIds empty hoặc chưa process) |
| `500` | Internal server error |

## Permission

Tất cả API yêu cầu một trong:
- `operation-tournament.update-result`
- `operation-tracking.view`
