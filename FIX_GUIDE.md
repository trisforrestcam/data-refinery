# Hướng dẫn Fix Data-Refinery Integration

## Tình trạng hiện tại

CMS gọi Backend → Backend gọi ES trực tiếp. Data-refinery chưa tham gia vào flow đọc.
Mục tiêu: Backend thử gọi Data-refinery trước, nếu có data thì trả về, nếu không thì fallback ES.

---

## 1. Kiến trúc đúng

```
┌─────────────┐     ┌──────────────┐     ┌─────────────────┐     ┌──────────┐
│  CMS        │────▶│  Backend     │────▶│  Data-refinery  │────▶│ MongoDB  │
│  (Vue.js)   │     │  (NestJS)    │     │  (NestJS)       │     │          │
└─────────────┘     └──────────────┘     └─────────────────┘     └──────────┘
                           │                       │
                           │     Không có data     │
                           │◄──────────────────────┘
                           │
                           ▼
                    ┌──────────────┐
                    │ Elasticsearch│
                    └──────────────┘
```

---

## 2. Các vấn đề đã xác định

### 2.1. ES docs KHÔNG có `labels.media_content_id`

```json
{
  "labels": {
    "timeline_id": "xxx",
    "tenant_id": "vtvlive",
    "environment": "development",
    "stage": "sent",
    "platform": "ios"
    // KHÔNG CÓ: media_content_id, match_id, question_id
  }
}
```

**Hệ quả:** Data-refinery KHÔNG được filter theo `matchId` khi query ES. Chỉ được filter theo `timelineIds`.

### 2.2. Data-refinery Read API (`/metrics/*`) trả về ARRAY

Ví dụ `/metrics/platform`:
```json
[
  {
    "tenantId": "vtvlive",
    "matchId": "abc",
    "timelineId": "def",
    "platform": "ios",
    "sent": 100,
    "received": 90,
    "intervalFrom": "2024-01-01T00:00:00Z"
  }
]
```

Nhưng CMS mong đợi:
- **Per-question**: SINGLE object `{sent, received, rendered, failed, ...}`
- **Per-match**: Object + `questions[]` array

### 2.3. Missing endpoints

| CMS cần | Data-refinery có? |
|---------|------------------|
| `GET /metrics/platform` | ✅ Có |
| `GET /metrics/device` | ✅ Có |
| `GET /metrics/transport` | ✅ Có |
| `GET /metrics/sdk` | ✅ Có |
| `GET /metrics/failures` | ✅ Có |
| `GET /metrics/latency` | ✅ Có |
| `GET /metrics/timeseries` | ✅ Có |
| `GET /metrics/heatmap` | ❌ **KHÔNG CÓ** |
| Match-level aggregate | ❌ **KHÔNG CÓ** |

---

## 3. Cách fix đúng

### 3.1. Backend: Sửa `*ByMatchId` methods trong `TrackingMatchService`

Mỗi method cần:
1. Resolve `timelineIds` từ `matchId`
2. Gọi data-refinery `/realtime/*` với `timelineIds`
3. **Aggregate** array response thành single object (sum các fields)
4. Trả về format CMS mong đợi

**Ví dụ `getMatchFunnelByMatchId`:**

```typescript
async getMatchFunnelByMatchId(matchId: string, tenantId: string, query?: MatchQueryDto): Promise<MatchFunnelResponseDto> {
  const timelineIds = await this.tournamentService.resolveTimelineIdsFromMatchId(matchId);
  
  if (timelineIds.length === 0) {
    return { sent: 0, received: 0, rendered: 0, failed: 0, ... };
  }

  // Gọi data-refinery /realtime/funnel
  try {
    const params = {
      tenantId,
      timelineIds: timelineIds.join(','), // Hoặc dùng URLSearchParams đúng
      from: query?.from,
      to: query?.to,
      platform: query?.platform,
    };
    
    const result = await this.dataRefineryClient.get('funnel', params, tenantId);
    // result = {sent, received, rendered, failed, receiveRate, ...}
    
    // Query ES cho per-question breakdown
    const questions = await this.getPerQuestionBreakdownFromES(timelineIds, tenantId, query);
    
    return {
      ...result,
      matchId,
      questionCount: questions.length,
      questions,
    };
  } catch (error) {
    // Fallback to ES
    return this.getMatchFunnelFromES(matchId, tenantId, query);
  }
}
```

### 3.2. Data-refinery: Sửa `RealtimeService.buildEsQuery`

```typescript
private buildEsQuery(query: RealtimeQueryDto, tenantId: string) {
  const timelineIds = query.timelineIds?.length
    ? query.timelineIds
    : query.questionId
      ? [query.questionId]
      : undefined;

  // QUAN TRỌNG: Nếu đã có timelineIds, KHÔNG filter mediaContentId
  // Vì ES docs không có field này
  const mediaContentId = timelineIds ? undefined : query.matchId;

  return {
    timelineIds,
    tenantId,
    from: query.from ? new Date(query.from) : undefined,
    to: query.to ? new Date(query.to) : undefined,
    platform: query.platform,
    mediaContentId,
    environment: null as string | null,
  };
}
```

### 3.3. Data-refinery: Xóa `OVERLAY_METRICS_TENANT_ID` filter

Trong `scheduler-config.service.ts`:

```typescript
async getActiveTargets(): Promise<SchedulerTargetConfig[]> {
  const dbTargets = await this.targetModel.find({ enabled: true }).lean().exec();
  
  // KHÔNG filter theo envTenantId nữa
  // const envTenantId = process.env.OVERLAY_METRICS_TENANT_ID;
  // if (envTenantId) { ... }
  
  return dbTargets.filter(t => this.tenantCache.has(t.tenantId));
}
```

### 3.4. Backend: Thêm env

```env
DATA_REFINERY_URL=http://pcvtv:5001
DATA_REFINERY_INTERNAL_API_KEY={8M1GuRL86}E
DATA_REFINERY_TIMEOUT_MS=10000
```

---

## 4. Cách test từng bước

### Bước 1: Test data-refinery API trực tiếp

```bash
# Test realtime funnel
curl "http://pcvtv:5001/realtime/funnel?timelineIds=TIMELINE_ID" \
  -H "x-tenant-id: vtvlive" \
  -H "x-internal-api-key: {8M1GuRL86}E"

# Test metrics (pre-aggregated)
curl "http://pcvtv:5001/metrics/platform?matchId=MATCH_ID" \
  -H "x-tenant-id: vtvlive" \
  -H "x-internal-api-key: {8M1GuRL86}E"
```

### Bước 2: Test Backend endpoint

```bash
# Test per-question (đã có data-refinery fast-path)
curl "http://BACKEND:PORT/api/report/tracking/timeline/by-match-question/funnel?questionId=QID&matchId=MID" \
  -H "X-TENANT-ID: vtvlive" \
  -H "Authorization: Bearer TOKEN"

# Test per-match (cần sửa)
curl "http://BACKEND:PORT/api/report/tracking/match/MID/funnel" \
  -H "X-TENANT-ID: vtvlive" \
  -H "Authorization: Bearer TOKEN"
```

### Bước 3: Check MongoDB

```javascript
// Sau khi backfill hoặc cron chạy
db.overlaymetricsplatforms.countDocuments()
db.overlaymetricsdevices.countDocuments()
db.overlaymetricstransports.countDocuments()
// ...
```

### Bước 4: Check scheduler targets

```javascript
db.scheduler_targets.find()
```

---

## 5. Lưu ý quan trọng

1. **Backend deploy** phải restart để nhận env mới
2. **Data-refinery deploy** phải restart để nhận code mới
3. **ES không có `media_content_id`** → Đừng bao giờ query ES bằng matchId trong data-refinery
4. **CMS expects single object** → Backend phải aggregate array từ data-refinery
5. **Heatmap endpoint missing** → Cần implement trong data-refinery hoặc tổng hợp từ platform metrics
6. **Tenant ID** phải khớp giữa `scheduler_targets.tenantId` và `tenants.name`

---

## 6. File cần sửa (tóm tắt)

### Data-refinery:
- `.env.local` — Xóa `OVERLAY_METRICS_TENANT_ID`
- `src/modules/overlay-metrics-etl/scheduler/scheduler-config.service.ts` — Xóa tenant filter
- `src/modules/overlay-metrics-api/realtime/realtime.service.ts` — Sửa `buildEsQuery`

### Backend:
- `.env.local` — Thêm `DATA_REFINERY_URL`, `DATA_REFINERY_INTERNAL_API_KEY`
- `src/report/tracking/tracking-match.service.ts` — Sửa `*ByMatchId` methods để gọi data-refinery
- `src/report/tracking/tracking.module.ts` — Đảm bảo `DataRefineryClient` đã import (đã có)

---

## 7. Debug tips

1. **Nếu data-refinery trả về []**:
   - Check `timelineIds` có đúng không
   - Check `labels.environment` trong ES có khớp config không
   - Check `labels.tenant_id` có đúng không

2. **Nếu Backend throw "DATA_REFINERY_URL is not configured"**:
   - Backend chưa restart
   - Hoặc env chưa được load

3. **Nếu MongoDB vẫn trống sau backfill**:
   - Check Kafka consumer có chạy không
   - Check log data-refinery có lỗi gì không
   - Check `scheduler_targets` có target không
   - Check ETL pipeline có lỗi ở bước nào

4. **Nếu CMS hiển thị 0**:
   - Check response format có đúng không (single object vs array)
   - Check `checkNoData` logic trong Vue component
