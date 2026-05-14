# 05 — Implementation Guide

Tài liệu này mô tả chi tiết cách triển khai từng tầng của ETL pipeline và Read API, dựa trên source code thực tế trong repository.

---

## 1. Overview

Hệ thống gồm 2 domain feature chính:

- **`overlay-metrics-etl`** — Pipeline Extract → Transform → Load, chạy định kỳ 5 phút/lần qua BullMQ.
- **`overlay-metrics-api`** — Read API để internal services query dữ liệu đã pre-aggregate từ MongoDB.

```
Scheduler (BullMQ) → Processor → Extractor (ES agg) → Transformer → Loader → Repository → MongoDB
                                           ↑                                              ↓
                                    Elasticsearch                                       Read API
```

---

## 2. Extractor Layer

### 2.1 Facade

**File:** `src/modules/overlay-metrics-etl/extractor/extractor.service.ts`

`ExtractorService` là facade, không chứa logic phức tạp — chỉ delegate sang `TrackingEsService`. Tồn tại để dễ thay đổi data source sau này (thêm cache, circuit breaker, v.v.).

```typescript
@Injectable()
export class ExtractorService {
  constructor(private readonly trackingEsService: TrackingEsService) {}

  async extractPlatformMetrics(query: TrackingAggQuery) {
    return this.trackingEsService.queryPlatformMetrics(query);
  }

  async extractDeviceBreakdown(query: TrackingAggQuery, dimension: string) {
    return this.trackingEsService.queryDeviceBreakdown(query, dimension);
  }

  async extractTransportComparison(query: TrackingAggQuery) {
    return this.trackingEsService.queryTransportComparison(query);
  }

  async extractSdkVersions(query: TrackingAggQuery) {
    return this.trackingEsService.querySdkVersions(query);
  }

  async extractFailures(query: TrackingAggQuery) {
    return this.trackingEsService.queryFailures(query);
  }

  async extractLatency(query: TrackingAggQuery) {
    return this.trackingEsService.queryLatency(query);
  }

  async extractTimeseries(query: TrackingAggQuery, metric: string, interval: string) {
    return this.trackingEsService.queryTimeseries(query, metric, interval);
  }
}
```

### 2.2 Elasticsearch Queries

**File:** `src/modules/overlay-metrics-etl/extractor/elasticsearch/tracking-es.service.ts`

`TrackingEsService` chứa 7 query methods tương ứng 7 metric types. Tất cả queries đều dùng ES client v9 syntax (flat, không có `body` wrapper).

**Base query builder:**

```typescript
private buildBaseQuery(query: TrackingAggQuery): Record<string, unknown> {
  if (!query.tenantId) {
    throw new Error('tenantId is required for Elasticsearch queries');
  }

  const must: Record<string, unknown>[] = [
    { term: { 'labels.tenant_id': query.tenantId } },
    {
      term: {
        'labels.environment': this.configService.get<string>(
          'app.elasticApmEnvironment',
          'development',
        ),
      },
    },
  ];

  if (query.timelineIds?.length) {
    must.push({ terms: { 'labels.timeline_id': query.timelineIds } });
  }

  if (query.mediaContentId) {
    must.push({ term: { 'labels.media_content_id': query.mediaContentId } });
  }

  const rangeFilter: Record<string, string> = {};
  if (query.from) rangeFilter.gte = query.from.toISOString();
  if (query.to) rangeFilter.lt = query.to.toISOString();
  if (Object.keys(rangeFilter).length > 0) {
    must.push({ range: { '@timestamp': rangeFilter } });
  }

  if (query.platform) {
    must.push({ term: { 'labels.platform': query.platform } });
  }

  return { bool: { must } };
}
```

**Platform metrics query** — `terms` theo `labels.platform`, nested filters cho `sent`/`received`/`rendered`/`failed`:

```typescript
async queryPlatformMetrics(query: TrackingAggQuery): Promise<TrackingAggResult<PlatformMetricsAggs>> {
  const esQuery = this.buildBaseQuery(query);
  const result = await this.esService.search<unknown, PlatformMetricsAggs>({
    index: this.getIndex(),
    size: 0,
    query: esQuery,
    aggs: {
      platforms: {
        terms: { field: 'labels.platform', size: 100, missing: 'unknown' },
        aggs: {
          sent: {
            filter: { term: { 'labels.stage': 'sent' } },
            aggs: { room_size_sum: { sum: { field: 'numeric_labels.room_size' } } },
          },
          received: { filter: { term: { 'labels.stage': 'received' } } },
          rendered: {
            filter: { term: { 'labels.stage': 'rendered' } },
            aggs: { avg_render_ms: { avg: { field: 'numeric_labels.render_duration_ms' } } },
          },
          failed: { filter: { term: { 'labels.stage': 'render-failed' } } },
        },
      },
    },
  }, { requestTimeout: this.getRequestTimeout() });

  return { aggregations: result.aggregations, took: result.took };
}
```

**Device breakdown query** — `terms` theo dimension (`browser`/`os`/`deviceClass`), `filters` theo stage:

```typescript
async queryDeviceBreakdown(query: TrackingAggQuery, dimension: string): Promise<...> {
  const fieldMap: Record<string, string> = {
    browser: 'labels.browser',
    os: 'labels.client_os',
    deviceClass: 'labels.device_class',
  };
  // ... terms + filters aggregation
}
```

**Transport comparison query** — `terms` theo `labels.transport_mode`, tính `avg_render_ms` và `p95_render_ms`.

**SDK version query** — `terms` theo `labels.sdk_version`.

**Failures query** — 2-level `terms`: `failure_reason` → `failure_step`.

**Latency query** — `percentiles` và `stats` cho `receive_latency_ms`, `render_duration_ms`, `ack_latency_ms`, cộng thêm `render_duration` percentiles.

**Timeseries query** — `date_histogram` với `fixed_interval`, metric value được map theo `metricMap`:

```typescript
const metricMap: Record<string, { type: string; field?: string }> = {
  sent: { type: 'sum', field: 'numeric_labels.room_size' },
  received: { type: 'count' },
  rendered: { type: 'count' },
  failed: { type: 'count' },
  avgRenderMs: { type: 'avg', field: 'numeric_labels.render_duration_ms' },
};
```

### 2.3 Aggregation Types

**File:** `src/modules/overlay-metrics-etl/extractor/elasticsearch/types/tracking-es-aggs.types.ts`

Định nghĩa TypeScript interfaces cho từng aggregation response từ ES (ví dụ: `PlatformMetricsAggs`, `DeviceBreakdownAggs`, `TimeseriesAggs`, ...).

### 2.4 Query DTO

**File:** `src/modules/overlay-metrics-etl/extractor/dto/tracking-agg-query.dto.ts`

```typescript
export class TrackingAggQuery {
  @IsOptional() @IsArray() @IsString({ each: true })
  timelineIds?: string[];

  @IsOptional() @IsString()
  mediaContentId?: string;

  @IsString() @IsNotEmpty()
  tenantId!: string;

  @IsOptional() @IsDate() @Type(() => Date)
  from?: Date;

  @IsOptional() @IsDate() @Type(() => Date)
  to?: Date;

  @IsOptional() @IsString()
  platform?: string;
}
```

---

## 3. Transformer Layer

**File:** `src/modules/overlay-metrics-etl/transformer/transformer.service.ts`

`TransformerService` chuyển ES aggregation results thành DTOs để persist vào MongoDB. Có 7 transform methods tương ứng, cộng 2 helper private.

### 3.1 Shared Helpers

```typescript
private normalizeValue(value: number | null | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.round(value * 100) / 100;
}

private calculateRate(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return this.normalizeValue((numerator / denominator) * 100);
}
```

### 3.2 Transform Methods

| Method | Input Aggregation | Output DTO |
|--------|------------------|------------|
| `transformPlatformMetrics` | `PlatformMetricsAggs` | `PlatformMetricDto[]` |
| `transformDeviceBreakdown` | `DeviceBreakdownAggs` | `DeviceBreakdownDto[]` |
| `transformTransportComparison` | `TransportComparisonAggs` | `TransportComparisonDto[]` |
| `transformSdkVersions` | `SdkVersionAggs` | `SdkVersionDto[]` |
| `transformFailures` | `FailureAggs` | `FailureAnalysisDto[]` |
| `transformLatency` | `LatencyAggs` | `LatencyPercentileDto` (object, không phải array) |
| `transformTimeseries` | `TimeseriesAggs` | `TimeseriesPointDto[]` |

**Ví dụ `transformPlatformMetrics`:**

```typescript
transformPlatformMetrics(aggregations: PlatformMetricsAggs | undefined, ctx: TransformContext): PlatformMetricDto[] {
  const buckets = aggregations?.platforms?.buckets ?? [];

  return buckets.map((bucket) => {
    const sent = this.normalizeValue(bucket.sent?.room_size_sum?.value);
    const received = this.normalizeValue(bucket.received?.doc_count);
    const rendered = this.normalizeValue(bucket.rendered?.doc_count);
    const failed = this.normalizeValue(bucket.failed?.doc_count);

    return {
      timelineId: ctx.timelineId,
      matchId: ctx.matchId,
      tenantId: ctx.tenantId,
      platform: String(bucket.key || 'unknown'),
      sent, received, rendered, failed,
      receiveRate: this.calculateRate(received, sent),
      renderRate: this.calculateRate(rendered, received),
      failureRate: this.calculateRate(failed, received),
      netSuccessRate: this.calculateRate(rendered, sent),
      avgRenderMs: this.normalizeValue(bucket.rendered?.avg_render_ms?.value),
      intervalFrom: ctx.intervalFrom,
      intervalTo: ctx.intervalTo,
    };
  });
}
```

**Ví dụ `transformLatency`:** Trả về 1 object (không phải array), chứa `receive`, `render`, `ack` (mỗi cái có `p50`/`p75`/`p95`/`p99`/`avg`/`max`), và `renderDuration` (có `p50`/`p95`/`p99`/`avg`).

**Ví dụ `transformTimeseries`:**

```typescript
transformTimeseries(aggregations: TimeseriesAggs | undefined, ctx: TransformContext, metric: string, interval: string): TimeseriesPointDto[] {
  const buckets = aggregations?.timeseries?.buckets ?? [];

  return buckets.map((bucket) => ({
    timelineId: ctx.timelineId,
    matchId: ctx.matchId,
    tenantId: ctx.tenantId,
    metric,
    interval,
    time: new Date(bucket.key_as_string ?? bucket.key ?? Date.now()),
    value: bucket.metric_value?.doc_count !== undefined
      ? this.normalizeValue(bucket.metric_value.doc_count)
      : this.normalizeValue(bucket.metric_value?.value ?? 0),
    intervalFrom: ctx.intervalFrom,
    intervalTo: ctx.intervalTo,
  }));
}
```

### 3.3 Unit Tests

**File:** `src/modules/overlay-metrics-etl/transformer/transformer.service.spec.ts`

Test suite cover tất cả 7 transform methods, bao gồm edge cases: zero sent, empty aggregations (trả về `[]` hoặc object rỗng), và percentOfFailed calculation.

---

## 4. Loader Layer

**File:** `src/modules/overlay-metrics-etl/loader/loader.service.ts`

`LoaderService` là tầng cuối của ETL pipeline. **Delegate hoàn toàn cho `OverlayMetricsRepository`** — không dùng `@InjectModel` trực tiếp. Mỗi method chỉ gọi `repository.upsert(MetricType.XXX, items)`.

```typescript
@Injectable()
export class LoaderService {
  private readonly logger = new Logger(LoaderService.name);

  constructor(private readonly repository: OverlayMetricsRepository) {}

  async loadPlatformMetrics(items: PlatformMetricDto[]): Promise<void> {
    if (!items.length) return;
    await this.repository.upsert(MetricType.PLATFORM, items as unknown as Record<string, unknown>[]);
    this.logger.log(`Upserted ${items.length} platform metrics`);
  }

  async loadDeviceBreakdown(items: DeviceBreakdownDto[]): Promise<void> {
    if (!items.length) return;
    await this.repository.upsert(MetricType.DEVICE, items as unknown as Record<string, unknown>[]);
    this.logger.log(`Upserted ${items.length} device breakdowns`);
  }

  // ... tương tự cho transport, sdk, failures, latency, timeseries
}
```

---

## 5. Scheduler & Processor

### 5.1 Scheduler

**File:** `src/modules/overlay-metrics-etl/scheduler/scheduler.service.ts`

`SchedulerService` implements `OnModuleInit`. Đọc 3 env vars:

- `OVERLAY_METRICS_TENANT_ID`
- `OVERLAY_METRICS_MATCH_ID`
- `OVERLAY_METRICS_TIMELINE_IDS` (comma-separated)

Nếu thiếu bất kỳ var nào → log warning và **không đăng ký scheduler**.

```typescript
@Injectable()
export class SchedulerService implements OnModuleInit {
  private readonly logger = new Logger(SchedulerService.name);

  constructor(
    @InjectQueue(OVERLAY_METRICS_QUEUE)
    private readonly queue: Queue,
  ) {}

  async onModuleInit(): Promise<void> {
    const tenantId = process.env.OVERLAY_METRICS_TENANT_ID;
    const matchId = process.env.OVERLAY_METRICS_MATCH_ID;
    const timelineIds = process.env.OVERLAY_METRICS_TIMELINE_IDS
      ? process.env.OVERLAY_METRICS_TIMELINE_IDS.split(',').map((s) => s.trim())
      : [];

    if (!tenantId || !matchId || timelineIds.length === 0) {
      this.logger.warn(
        'Overlay metrics scheduler missing required env vars: OVERLAY_METRICS_TENANT_ID, OVERLAY_METRICS_MATCH_ID, OVERLAY_METRICS_TIMELINE_IDS. Scheduler will not be registered.',
      );
      return;
    }

    await this.queue.upsertJobScheduler(
      OVERLAY_METRICS_SCHEDULER_ID,
      { every: 5 * 60 * 1000 }, // 5 minutes
      {
        name: OVERLAY_METRICS_JOB,
        data: { timeRangeMinutes: 5, tenantId, matchId, timelineIds },
        opts: {
          attempts: 3,
          backoff: { type: 'exponential', delay: 5000 },
        },
      },
    );

    this.logger.log('Overlay metrics scheduler registered (every 5 minutes)');
  }
}
```

### 5.2 Processor

**File:** `src/modules/overlay-metrics-etl/scheduler/processors/overlay-metrics.processor.ts`

`OverlayMetricsProcessor` extends `WorkerHost`. Route job bằng `job.name`. Nếu không phải `OVERLAY_METRICS_JOB` thì log warn và return.

**Job data interface:**

```typescript
interface OverlayMetricsJobData {
  timeRangeMinutes: number;
  timelineIds: string[];
  tenantId: string;
  matchId: string;
  intervalFrom?: string | Date;
  intervalTo?: string | Date;
}
```

**Core methods:**

- `validateJobData(data)` — kiểm tra `timeRangeMinutes` phải là number > 0, `timelineIds` là non-empty array, `tenantId` và `matchId` là non-empty string.
- `parseOptionalDate(value, field)` — parse string hoặc Date object từ job data.
- `resolveInterval(data, job, intervalMs)` — **ưu tiên explicit `intervalFrom`/`intervalTo`** từ job data (hỗ trợ backfill). Nếu không có, tính từ `job.timestamp + delay` và round xuống bội số của `intervalMs`.
- `processTimeline(timelineId, matchId, tenantId, intervalFrom, intervalTo)` — chạy 7 bước ETL cho 1 timeline.

**Resolve interval logic:**

```typescript
private resolveInterval(data: OverlayMetricsJobData, job: Job, intervalMs: number): { intervalFrom: Date; intervalTo: Date } {
  const explicitFrom = this.parseOptionalDate(data.intervalFrom, 'intervalFrom');
  const explicitTo = this.parseOptionalDate(data.intervalTo, 'intervalTo');

  if (explicitFrom || explicitTo) {
    if (!explicitFrom || !explicitTo || explicitFrom >= explicitTo) {
      throw new Error('intervalFrom and intervalTo must both be valid and ordered');
    }
    return { intervalFrom: explicitFrom, intervalTo: explicitTo };
  }

  const scheduledAtMs = job.timestamp + Math.max(job.delay ?? 0, 0);
  const intervalTo = new Date(Math.floor(scheduledAtMs / intervalMs) * intervalMs);
  const intervalFrom = new Date(intervalTo.getTime() - intervalMs);

  return { intervalFrom, intervalTo };
}
```

**Timeline processing flow** (chạy tuần tự, 1 timeline fail → throw để BullMQ retry):

1. `extractPlatformMetrics` → `transformPlatformMetrics` → `loadPlatformMetrics`
2. Loop 3 dimensions: `browser`, `os`, `deviceClass`
3. `extractTransportComparison` → `transformTransportComparison` → `loadTransportComparison`
4. `extractSdkVersions` → `transformSdkVersions` → `loadSdkVersions`
5. `extractFailures` → `transformFailures` → `loadFailures`
6. `extractLatency` → `transformLatency` → `loadLatency([latencyData])` *(array với 1 element)*
7. Loop 5 metrics: `sent`, `received`, `rendered`, `failed`, `avgRenderMs` — mỗi cái với interval `5m`

---

## 6. Repository Layer

**File:** `src/infrastructure/persistence/overlay-metrics.repository.ts`

`OverlayMetricsRepository` inject 7 Mongoose Models, gom vào `Record<MetricType, Model<any>>`.

```typescript
@Injectable()
export class OverlayMetricsRepository {
  private readonly models: Record<MetricType, Model<any>>;

  constructor(
    @InjectModel(OverlayMetricsPlatform.name) platform: Model<OverlayMetricsPlatform>,
    @InjectModel(OverlayMetricsDevice.name) device: Model<OverlayMetricsDevice>,
    @InjectModel(OverlayMetricsTransport.name) transport: Model<OverlayMetricsTransport>,
    @InjectModel(OverlayMetricsSdk.name) sdk: Model<OverlayMetricsSdk>,
    @InjectModel(OverlayMetricsFailure.name) failure: Model<OverlayMetricsFailure>,
    @InjectModel(OverlayMetricsTimeseries.name) timeseries: Model<OverlayMetricsTimeseries>,
    @InjectModel(OverlayMetricsLatency.name) latency: Model<OverlayMetricsLatency>,
  ) {
    this.models = {
      [MetricType.PLATFORM]: platform,
      [MetricType.DEVICE]: device,
      [MetricType.TRANSPORT]: transport,
      [MetricType.SDK]: sdk,
      [MetricType.FAILURE]: failure,
      [MetricType.TIMESERIES]: timeseries,
      [MetricType.LATENCY]: latency,
    };
  }
```

### 6.1 Upsert (Accumulate)

Dùng `bulkWrite(updateOne + upsert)` với:

- `$inc` — accumulate fields từ `INC_FIELDS`
- `$set` — remaining fields (ghi đè)
- `$setOnInsert: { createdAt: new Date() }`
- `$currentDate: { updatedAt: true }`

```typescript
async upsert(type: MetricType, items: Record<string, unknown>[]): Promise<void> {
  if (!items.length) return;
  const model = this.models[type];
  const ops = this.buildUpsertOps(items, UNIQUE_FIELDS[type], INC_FIELDS[type]);
  await model.bulkWrite(ops, { ordered: false });
}
```

**Upsert operation builder:**

```typescript
private buildUpsertOps<T extends object>(
  items: T[],
  uniqueFields: string[],
  incFields: string[],
): AnyBulkWriteOperation<any>[] {
  return items.map((item) => {
    const record = item as Record<string, unknown>;
    const filter: Record<string, unknown> = {};

    for (const field of uniqueFields) {
      if (record[field] === undefined || record[field] === null) {
        throw new Error(`Missing unique field "${field}" required for upsert filter`);
      }
      filter[field] = record[field];
    }

    const $inc: Record<string, number> = {};
    const $set: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(record)) {
      if (value === undefined) continue;
      if (incFields.includes(key) && typeof value === 'number') {
        $inc[key] = value;
      } else {
        $set[key] = value;
      }
    }

    const update: Record<string, unknown> = {
      $setOnInsert: { createdAt: new Date() },
      $currentDate: { updatedAt: true },
    };
    if (Object.keys($inc).length > 0) update.$inc = $inc;
    if (Object.keys($set).length > 0) update.$set = $set;

    return { updateOne: { filter, update, upsert: true } };
  });
}
```

### 6.2 Find (Read API)

```typescript
async find(type: MetricType, filter: Record<string, unknown>): Promise<any[]> {
  const model = this.models[type];
  const sortField = SORT_FIELDS[type];
  return model.find(filter).sort({ [sortField]: -1 }).lean().exec();
}
```

### 6.3 Metadata

**File:** `src/infrastructure/persistence/metric-meta.ts`

Định nghĩa 3 lookup tables:

- `UNIQUE_FIELDS` — composite key cho upsert filter (tất cả dựa trên `matchId` để accumulate từ nhiều timelines)
- `INC_FIELDS` — fields cần accumulate (`sent`, `received`, `rendered`, `failed`, `count`, `value`). `LATENCY` có array rỗng vì không thể cộng dồn percentiles.
- `SORT_FIELDS` — default sort field cho query (`time` cho timeseries, `intervalFrom` cho các loại khác).

---

## 7. Read API

### 7.1 Controller

**File:** `src/modules/overlay-metrics-api/metrics-api.controller.ts`

`@Controller('metrics')`, `@UseGuards(InternalApiGuard)`, có 7 GET endpoints:

```typescript
@UseGuards(InternalApiGuard)
@Controller('metrics')
export class MetricsApiController {
  constructor(private readonly metricsApiService: MetricsApiService) {}

  @Get('platform')
  async getPlatform(@Headers('x-tenant-id') tenantId: string, @Query() query: MetricsQueryDto) { ... }

  @Get('device')
  async getDevice(@Headers('x-tenant-id') tenantId: string, @Query() query: MetricsQueryDto) { ... }

  @Get('transport')
  async getTransport(@Headers('x-tenant-id') tenantId: string, @Query() query: MetricsQueryDto) { ... }

  @Get('sdk')
  async getSdk(@Headers('x-tenant-id') tenantId: string, @Query() query: MetricsQueryDto) { ... }

  @Get('failures')
  async getFailures(@Headers('x-tenant-id') tenantId: string, @Query() query: MetricsQueryDto) { ... }

  @Get('latency')
  async getLatency(@Headers('x-tenant-id') tenantId: string, @Query() query: MetricsQueryDto) { ... }

  @Get('timeseries')
  async getTimeseries(
    @Headers('x-tenant-id') tenantId: string,
    @Query() query: MetricsQueryDto,
    @Query('metric') metric?: string,
  ) { ... }
}
```

Tất cả endpoints đều yêu cầu header `x-tenant-id` và `x-internal-api-key`.

### 7.2 Service

**File:** `src/modules/overlay-metrics-api/metrics-api.service.ts`

`MetricsApiService` có `buildFilter()` helper (standalone function) và delegate `repository.find()`:

```typescript
function buildFilter(tenantId: string, query: MetricsQueryDto): Record<string, any> {
  const filter: Record<string, any> = { tenantId };

  if (query.matchId) filter.matchId = query.matchId;

  if (query.timelineIds && query.timelineIds.length > 0) {
    filter.timelineId = { $in: query.timelineIds };
  }

  if (query.from || query.to) {
    filter.intervalFrom = {};
    if (query.from) filter.intervalFrom.$gte = new Date(query.from);
    if (query.to) filter.intervalFrom.$lte = new Date(query.to);
  }

  return filter;
}
```

`getTimeseries` có thêm param `metric` để filter theo metric name:

```typescript
async getTimeseries(tenantId: string, query: MetricsQueryDto, metric?: string) {
  const filter = buildFilter(tenantId, query);
  if (metric) filter.metric = metric;
  return this.repository.find(MetricType.TIMESERIES, filter);
}
```

### 7.3 Query DTO

**File:** `src/modules/overlay-metrics-api/dto/metrics-query.dto.ts`

```typescript
export class MetricsQueryDto {
  @ApiPropertyOptional({ description: 'Match ID', example: '000000000000000000000000' })
  @IsOptional() @IsString()
  matchId?: string;

  @ApiPropertyOptional({ description: 'Timeline ID(s)', example: ['timeline-001'], isArray: true })
  @IsOptional() @IsString({ each: true })
  @Transform(({ value }) => (Array.isArray(value) ? value : [value]))
  timelineIds?: string[];

  @ApiPropertyOptional({ description: 'Start date (ISO 8601)', example: '2024-01-01T00:00:00Z' })
  @IsOptional() @IsDateString()
  from?: string;

  @ApiPropertyOptional({ description: 'End date (ISO 8601)', example: '2024-01-02T00:00:00Z' })
  @IsOptional() @IsDateString()
  to?: string;
}
```

### 7.4 Auth Guard

**File:** `src/common/guards/internal-api.guard.ts`

```typescript
@Injectable()
export class InternalApiGuard implements CanActivate {
  private readonly apiKey = process.env.INTERNAL_API_KEY;

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const headerKey = request.headers['x-internal-api-key'];

    if (!this.apiKey) {
      throw new UnauthorizedException('INTERNAL_API_KEY not configured');
    }

    if (!headerKey || headerKey !== this.apiKey) {
      throw new UnauthorizedException('Invalid or missing internal API key');
    }

    return true;
  }
}
```

---

## 8. Constants & Configuration

**File:** `src/common/constants/scheduler.constants.ts`

```typescript
export const OVERLAY_METRICS_QUEUE = 'overlay-metrics' as const;
export const OVERLAY_METRICS_SCHEDULER_ID = 'overlay-metrics-every-5min' as const;
export const OVERLAY_METRICS_JOB = 'extract-transform-load-metrics' as const;
```

---

## 9. DTOs, Schemas & Shared Interfaces

### 9.1 DTOs (barrel)

**File:** `src/domain/dto/index.ts`

Export từ 7 files:
- `platform-metric.dto.ts`
- `device-breakdown.dto.ts`
- `transport-comparison.dto.ts`
- `sdk-version.dto.ts`
- `failure-analysis.dto.ts`
- `latency-percentile.dto.ts`
- `timeseries-point.dto.ts`

### 9.2 Schemas (barrel)

**File:** `src/domain/schemas/index.ts`

Export từ 7 files:
- `overlay-metrics-platform.schema.ts`
- `overlay-metrics-device.schema.ts`
- `overlay-metrics-transport.schema.ts`
- `overlay-metrics-sdk.schema.ts`
- `overlay-metrics-failure.schema.ts`
- `overlay-metrics-timeseries.schema.ts`
- `overlay-metrics-latency.schema.ts`

### 9.3 TransformContext

**File:** `src/common/interfaces/transform-context.interface.ts`

```typescript
export interface TransformContext {
  timelineId: string;
  matchId: string;
  tenantId: string;
  intervalFrom: Date;
  intervalTo: Date;
}
```

### 9.4 MetricType Enum

**File:** `src/domain/enums/metric-type.enum.ts`

```typescript
export enum MetricType {
  PLATFORM = 'platform',
  DEVICE = 'device',
  TRANSPORT = 'transport',
  SDK = 'sdk',
  FAILURE = 'failure',
  TIMESERIES = 'timeseries',
  LATENCY = 'latency',
}
```

---

## 10. Error Handling & Retry

- Processor throw error nếu 1 timeline fail → BullMQ retry theo config (`attempts: 3`, `backoff: exponential 5s`).
- ES query timeout lấy từ config `elasticsearch.trackingTimeoutMs`, default 10s.
- Scheduler không đăng ký nếu thiếu env vars — không crash app.
- `normalizeValue` đảm bảo không có `NaN`/`Infinity` lọt vào MongoDB.

---

## File Index (Quick Reference)

| Component | Path |
|-----------|------|
| Extractor Facade | `src/modules/overlay-metrics-etl/extractor/extractor.service.ts` |
| ES Queries | `src/modules/overlay-metrics-etl/extractor/elasticsearch/tracking-es.service.ts` |
| ES Agg Types | `src/modules/overlay-metrics-etl/extractor/elasticsearch/types/tracking-es-aggs.types.ts` |
| Extractor DTO | `src/modules/overlay-metrics-etl/extractor/dto/tracking-agg-query.dto.ts` |
| Transformer | `src/modules/overlay-metrics-etl/transformer/transformer.service.ts` |
| Transformer Tests | `src/modules/overlay-metrics-etl/transformer/transformer.service.spec.ts` |
| Loader | `src/modules/overlay-metrics-etl/loader/loader.service.ts` |
| Scheduler | `src/modules/overlay-metrics-etl/scheduler/scheduler.service.ts` |
| Processor | `src/modules/overlay-metrics-etl/scheduler/processors/overlay-metrics.processor.ts` |
| Repository | `src/infrastructure/persistence/overlay-metrics.repository.ts` |
| Repository Meta | `src/infrastructure/persistence/metric-meta.ts` |
| API Controller | `src/modules/overlay-metrics-api/metrics-api.controller.ts` |
| API Service | `src/modules/overlay-metrics-api/metrics-api.service.ts` |
| API Query DTO | `src/modules/overlay-metrics-api/dto/metrics-query.dto.ts` |
| Auth Guard | `src/common/guards/internal-api.guard.ts` |
| Constants | `src/common/constants/scheduler.constants.ts` |
| Domain DTOs | `src/domain/dto/index.ts` |
| Domain Schemas | `src/domain/schemas/index.ts` |
| MetricType Enum | `src/domain/enums/metric-type.enum.ts` |
| TransformContext | `src/common/interfaces/transform-context.interface.ts` |
