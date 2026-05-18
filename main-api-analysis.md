# Main & Metrics API Controller Analysis

## Files Examined
- `src/main.ts` (full)
- `src/modules/overlay-metrics-api/metrics-api.controller.ts` (full)
- `src/common/guards/internal-api.guard.ts` (full)
- `src/modules/overlay-metrics-api/metrics-api.service.ts` (full)
- `src/modules/overlay-metrics-api/dto/metrics-query.dto.ts` (full)
- `src/modules/overlay-metrics-api/dto/backfill-job.dto.ts` (full)
- `src/modules/overlay-metrics-api/dto/scheduler-target.dto.ts` (full)
- `src/modules/overlay-metrics-api/realtime/realtime.controller.ts` (full)
- `src/config/app.config.ts` (full)
- `src/app.module.ts` (full)
- `src/modules/overlay-metrics-api/api.module.ts` (full)

---

## 1. ValidationPipe Configuration (`src/main.ts` lines 12–17)

```ts
app.useGlobalPipes(
  new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  }),
);
```

- **whitelist: true** — strips unknown properties from DTOs.
- **forbidNonWhitelisted: true** — throws `BadRequestException` (400) if any unexpected field is present in query/body.
- **transform: true** — auto-casts primitives to DTO-declared types (e.g. string → number when `@IsNumber()` is present).

> Impact: Any extra query param or body field not declared in the DTO will cause a **400** response.

---

## 2. Tenant ID Header Handling

### In Controller (`metrics-api.controller.ts`)
- Every endpoint receives `@Headers('x-tenant-id') tenantId: string`.
- **No validation** is applied to the header value itself in the controller (not marked `@IsString()`, not part of a DTO).
- The raw string is passed directly to `MetricsApiService` methods.

### In Service (`metrics-api.service.ts`)
- `tenantId` is inserted into the MongoDB filter as-is: `filter.tenantId = tenantId`.
- **No check** whether the tenant exists, is active, or is valid before querying.
- If `tenantId` is missing/empty, the repository will still query MongoDB with `{ tenantId: undefined }`, likely returning empty results instead of an error.

### Swagger Security
- `x-tenant-id` is registered as an `apiKey` security scheme and added to `securityRequirements` (`src/main.ts` lines 23–29).
- However, this is **documentation-only**; there is **no runtime guard** enforcing the header’s presence.

---

## 3. Guards That Reject Requests

### `InternalApiGuard` (`src/common/guards/internal-api.guard.ts`)
Applied at the **class level** on both `MetricsApiController` and `RealtimeController` via `@UseGuards(InternalApiGuard)`.

Behavior:
1. Reads `x-internal-api-key` header from the request.
2. Compares it against `this.config.get<string>('app.internalApiKey')` (loaded from `INTERNAL_API_KEY` env var).
3. If `INTERNAL_API_KEY` is **not configured** → throws `UnauthorizedException('INTERNAL_API_KEY not configured')`.
4. If header is **missing or mismatches** → throws `UnauthorizedException('Invalid or missing internal API key')`.

> **All API endpoints under `/metrics` and `/realtime` are protected by this guard.** Any request without the correct `x-internal-api-key` will receive **401**.

---

## 4. Global Exception Filters / Interceptors

**None found.**

Searched the entire `src/` tree for:
- `@Catch` decorators
- `ExceptionFilter` implementations
- `APP_FILTER` or `APP_INTERCEPTOR` tokens
- `UseInterceptors` or `UseFilters` decorators

Result: **zero matches**.

Implications:
- NestJS default exception handling is active. Unhandled errors bubble up as standard HTTP responses (e.g. 500 for unexpected errors, 400 for validation failures).
- **No custom filter swallows or transforms errors silently.**
- **No logging interceptor** automatically logs request/response cycles.

---

## 5. Additional Observations

### DTO Validation Details
| DTO | Key Constraints |
|-----|-----------------|
| `MetricsQueryDto` | All fields optional. `timelineIds` accepts single string or array and transforms to array. `from`/`to` must be ISO date strings. |
| `BackfillJobDto` | `tenantId`, `matchId`, `timelineIds` are required. `timeRangeMinutes` optional, min 1. |
| `SchedulerTargetDto` | `tenantId`, `matchId`, `timelineIds` required. `enabled` optional boolean. |

### Backfill Endpoint — Dual Tenant IDs
The `POST /metrics/backfill` endpoint accepts `tenantId` from **both** the `x-tenant-id` header and the `BackfillJobDto` body. In the service (`metrics-api.service.ts` line 125):

```ts
tenantId: dto.tenantId || tenantId,
```

The **body value takes precedence** over the header.

### Realtime Controller
`RealtimeController` (under `/realtime`) is **also** guarded by `InternalApiGuard` and receives `x-tenant-id` the same way. It queries Elasticsearch directly (not MongoDB).

---

## Summary Table

| Concern | Finding |
|---------|---------|
| ValidationPipe | Global, strict (`whitelist` + `forbidNonWhitelisted` + `transform`) |
| `x-tenant-id` presence | **Not enforced** at runtime; relied on downstream (repository filter) |
| `x-tenant-id` validation | None (any string accepted, including empty/missing) |
| Guard rejecting requests | `InternalApiGuard` on **all** `/metrics` and `/realtime` endpoints — requires `x-internal-api-key` |
| Global exception filters | **None** |
| Global interceptors | **None** |
| Error swallowing risk | Low — no custom filters/interceptors hide errors |

---

## Start Here for Next Steps

If you need to enforce `x-tenant-id` presence or validate it against the tenant cache, the first file to modify is:

**`src/modules/overlay-metrics-api/metrics-api.controller.ts`**

Alternatively, introduce a new guard (e.g. `TenantGuard`) in `src/common/guards/` and apply it alongside `InternalApiGuard`.
