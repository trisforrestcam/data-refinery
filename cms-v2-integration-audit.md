# Audit Report: interactive-cms-v2 ↔ data-refinery Integration

**Date:** 2026-05-15
**Audited Project:** `/home/tris/vtvlive/internal/interactive-cms-v2`
**Target Integration:** `data-refinery` (overlay metrics Read API)

---

## Executive Summary

**interactive-cms-v2 does NOT integrate directly with data-refinery.**

All overlay metrics UI calls are made to the **main CMS backend API** (`API_URL` → `api.onplay.live` and equivalents), not to the data-refinery service. The CMS backend presumably proxies or aggregates data from data-refinery internally, but no direct client-side or service-to-service calls to data-refinery endpoints were found in the cms-v2 codebase.

---

## 1. API Configuration & Base URL

| Config File | Key | Value (Production) |
|-------------|-----|-------------------|
| `nuxt.config.js` | `publicRuntimeConfig.apiUrl` | `process.env.API_URL` |
| `nuxt.config.js` | `axios.baseURL` | `process.env.API_URL` |
| `.env.example` | `API_URL` | `http://localhost:9989` |
| `deploy/production/env.example` | `API_URL` | `https://api.onplay.live/` |
| `deploy/staging/env.example` | `API_URL` | `https://beta-api.onplay.live/` |
| `deploy/develop/env.example` | `API_URL` | `https://dev-api.onplay.live/` |

**No separate data-refinery URL, proxy, or `metrics-api` configuration exists.**

### Axios Plugin (`plugins/axios.js`)
- Sets `baseURL` from `$config.apiUrl`
- Injects `Authorization: Bearer <token>`
- Injects `X-TENANT-ID: <tenantId>` (from auth store/localStorage)
- **No `x-internal-api-key` header** (data-refinery's `InternalApiGuard` requirement)

---

## 2. Metrics Endpoints Found

All endpoints are prefixed by the main `API_URL`.

### A. Timeline-by-Match-Question Endpoints
Used by `OverlayMetricsDialog.vue` via `store/api/tournament/control.js`.

| Action | Method | Endpoint Pattern |
|--------|--------|------------------|
| getOverlayTrackingMetrics | GET | `/api/timeline/by-match-question?questionId=&matchId=&platform=` |
| getTrackingFunnel | GET | `/api/report/tracking/timeline/by-match-question/funnel?...` |
| getTrackingLatency | GET | `/api/report/tracking/timeline/by-match-question/latency?...` |
| getTrackingFailures | GET | `/api/report/tracking/timeline/by-match-question/failures?...` |
| getTrackingDeviceBreakdown | GET | `/api/report/tracking/timeline/by-match-question/device-breakdown?...` |
| getTrackingTransportComparison | GET | `/api/report/tracking/timeline/by-match-question/transport-comparison?...` |
| getTrackingSdkVersions | GET | `/api/report/tracking/timeline/by-match-question/sdk-versions?...` |
| getTrackingTimeseries | GET | `/api/report/tracking/timeline/by-match-question/timeseries?...` |
| getTrackingHeatmap | GET | `/api/report/tracking/timeline/by-match-question/heatmap?...` |
| recalculateMetrics | POST | `/api/report/tracking/timeline/by-match-question/recalculate` |

### B. Direct Timeline Endpoints
Defined in `store/api/tracking/index.js` (timelineId-based). **No active Vue component references these directly** in the current grep scope, but they are exported.

| Method | Endpoint |
|--------|----------|
| GET | `/report/tracking/timeline/{timelineId}/funnel` |
| GET | `/report/tracking/timeline/{timelineId}/latency` |
| GET | `/report/tracking/timeline/{timelineId}/latency-histogram` |
| GET | `/report/tracking/timeline/{timelineId}/failures` |
| GET | `/report/tracking/timeline/{timelineId}/device-breakdown` |
| GET | `/report/tracking/timeline/{timelineId}/transport-comparison` |
| GET | `/report/tracking/timeline/{timelineId}/sdk-versions` |
| GET | `/report/tracking/timeline/{timelineId}/timeseries` |
| GET | `/report/tracking/timeline/{timelineId}/heatmap` |

### C. Match-Level Endpoints
Used by `MatchMetricsDialog.vue` via `store/api/tracking/index.js`.

| Method | Endpoint |
|--------|----------|
| GET | `/api/report/tracking/match/{matchId}/questions` |
| GET | `/api/report/tracking/match/{matchId}/funnel` |
| GET | `/api/report/tracking/match/{matchId}/latency` |
| GET | `/api/report/tracking/match/{matchId}/latency-histogram` |
| GET | `/api/report/tracking/match/{matchId}/failures` |
| GET | `/api/report/tracking/match/{matchId}/device-breakdown` |
| GET | `/api/report/tracking/match/{matchId}/transport-comparison` |
| GET | `/api/report/tracking/match/{matchId}/sdk-versions` |
| GET | `/api/report/tracking/match/{matchId}/timeseries` |
| GET | `/api/report/tracking/match/{matchId}/heatmap` |

---

## 3. UI Components Consuming Metrics

| Component | Location | Data Source | Metrics Shown |
|-----------|----------|-------------|---------------|
| `OverlayMetricsDialog.vue` | `components/op-onlive/tournament/control/` | `store/api/tournament/control.js` | Funnel, Latency, Device, Transport, SDK, Failures, Timeseries, Heatmap |
| `MatchMetricsDialog.vue` | `components/op-onlive/tournament/control/` | `store/api/tracking/index.js` | Funnel, Latency, Device, Transport, SDK, Failures, Timeseries, Heatmap, Per-Question Table |
| `LatencyChart.vue` | `components/common/metrics/` | Parent prop | Latency percentiles (p50, p75, p95, p99, avg, max) for receive/render/ack |
| `FunnelChart.vue` | `components/common/metrics/` | Parent prop | sent → received → rendered → failed |
| `DeviceBreakdownChart.vue` | `components/common/metrics/` | Parent prop | browser / os / deviceClass breakdown |
| `TransportComparisonChart.vue` | `components/common/metrics/` | Parent prop | ws vs iframe vs polling render rates |
| `SdkVersionTable.vue` | `components/common/metrics/` | Parent prop | SDK version counts & render rates |
| `FailureBreakdownChart.vue` | `components/common/metrics/` | Parent prop | Failure reasons & steps |
| `TimeseriesChart.vue` | `components/common/metrics/` | Parent prop | Time-bucketed sent/received/rendered/failed |
| `HeatmapChart.vue` | `components/common/metrics/` | Parent prop | Platform/heat intensity heatmap |
| `MetricCard.vue` | `components/common/metrics/` | Parent prop | KPI cards (sent, received, rendered, failureRate) |

---

## 4. services/overlay.js Analysis

- **File size:** 194,493 bytes
- **Content:** Bundled/minified webpack output of `LiveOverlay` SDK (client-side overlay library). Contains an embedded copy of axios.
- **Relevance to data-refinery:** **None.** It is a distributable library, not application service code calling metrics APIs.

---

## 5. services/ajax-handlers.js & services/ws.js

- `ajax-handlers.js`: Generic error/success toast handlers. No API calls.
- `ws.js`: WebSocket client (`socket.io-client`) for real-time worker data. No HTTP metrics integration.

---

## 6. Search Results for data-refinery Keywords

| Keyword | Occurrences in cms-v2 | Context |
|---------|----------------------|---------|
| `data-refinery` | 0 | — |
| `refinery` | 0 | — |
| `metrics-api` | 0 | — |
| `x-internal-api-key` | 0 | — |
| `INTERNAL_API_KEY` | 0 | — |
| `localhost:3000` | 0 | — |
| `overlay metrics` | Multiple | UI labels & translations only |
| `latency` | Multiple | UI labels + `LatencyChart.vue` + API paths |

---

## 7. Integration Architecture Conclusion

```
┌─────────────────────┐
│  interactive-cms-v2 │  (Nuxt 2 frontend)
│  (Vue components)   │
└─────────┬───────────┘
          │ HTTPS / Axios
          │ Authorization: Bearer <token>
          │ X-TENANT-ID: <tenantId>
          ▼
┌─────────────────────┐
│   Main CMS API      │  api.onplay.live (or dev/staging)
│  (/api/report/...)  │     ▲
└─────────────────────┘     │ (internal proxy/aggregation?)
                            │
                            │ (NOT visible from cms-v2)
                            ▼
                     ┌──────────────┐
                     │ data-refinery│  (NestJS + MongoDB)
                     │  (/metrics)  │
                     └──────────────┘
```

- **Direct integration?** ❌ No.
- **Indirect integration via CMS backend?** ✅ Yes. cms-v2 calls `/api/report/tracking/*` on the main CMS API, which likely proxies to or re-implements data from data-refinery.
- **Authentication mismatch:** cms-v2 uses `Bearer` token + `X-TENANT-ID` for its own API. data-refinery's Read API requires `x-internal-api-key`. This confirms cms-v2 does **not** call data-refinery directly.

---

## 8. Recommendations

1. **If data-refinery is intended to be called directly by cms-v2 in the future**, the cms-v2 project would need:
   - A new env var (e.g., `DATA_REFINERY_URL`)
   - `x-internal-api-key` header injection in axios or a Nuxt proxy module
   - CORS configuration on data-refinery (if browser-direct) or server-side proxy (if via Nuxt serverMiddleware)

2. **If the current architecture is intentional** (backend-aggregation), ensure the CMS API backend contract (`/api/report/tracking/*`) remains stable as data-refinery evolves.

3. **No action needed in cms-v2** for the current data-refinery rollout, as there is no direct dependency.
