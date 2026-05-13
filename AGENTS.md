# DataRefinery — Project Context

## Overview
DataRefinery là ETL pipeline NestJS chạy cron qua BullMQ, pull APM data từ Elasticsearch, transform rồi persist vào MongoDB.

## Stack
- **Framework:** NestJS 11 (modular monolith)
- **Task Queue:** BullMQ v5 (`upsertJobScheduler` cho cron idempotent)
- **Database:** MongoDB (Mongoose 9, `@nestjs/mongoose`)
- **Search:** Elasticsearch 9 (`@elastic/elasticsearch`)
- **Cache/Queue Backend:** Redis (for BullMQ)
- **Config:** `@nestjs/config` với `registerAs` + `forRootAsync`

## Architecture (ETL)
```
Scheduler (BullMQ) → Processor → Extractor (ES) → Transformer → Loader (MongoDB)
```
- `scheduler`: Chỉ enqueue job, KHÔNG chứa business logic nặng
- `extractor`: Query Elasticsearch APM (`traces-apm-*`), service dùng raw `@elastic/elasticsearch` client
- `transformer`: Map raw ECS fields → `RefinedDataDto`
- `loader`: Bulk write vào MongoDB qua generic repository pattern

## Project Structure
```
src/
├── config/               # app, redis, mongo, elasticsearch configs (registerAs)
├── common/
│   └── repositories/
│       └── base.repository.ts    # Generic repo extends Mongoose Model
├── modules/
│   ├── extractor/
│   │   ├── extractor.service.ts
│   │   ├── elasticsearch/elasticsearch.service.ts
│   │   └── dto/apm-query.dto.ts
│   ├── transformer/
│   │   ├── transformer.service.ts
│   │   └── dto/refined-data.dto.ts
│   ├── loader/
│   │   ├── loader.service.ts
│   │   ├── schemas/apm-record.schema.ts
│   │   └── repositories/apm-record.repository.ts
│   └── scheduler/
│       ├── scheduler.service.ts          # upsertJobScheduler on init
│       └── processors/
│           └── data-refinery.processor.ts
├── app.module.ts         # Wire up ConfigModule, MongooseModule, BullModule
└── main.ts
```

## Conventions
1. **Config:** Luôn dùng `registerAs` + `forRootAsync` cho infra modules. Không hardcode credentials.
2. **BullMQ:** Dùng `upsertJobScheduler` thay vì repeatable jobs cũ. Processor extends `WorkerHost`, route bằng `job.name` (không dùng `@Process()`).
3. **MongoDB:** Schemas dùng `@Schema()` + `@Prop()`. Persistence qua repository extends `BaseRepository<T>`.
4. **Elasticsearch:** Client được wrap trong service riêng. Query params truyền flat (không dùng `body` wrapper vì ES client v9).
5. **DTOs:** Đặt trong `dto/` folder của từng module.
6. **Bulk Operations:** Loader dùng `bulkWrite` cho batch inserts.
7. **Error Handling:** Các service nên log + throw để BullMQ retry theo config backoff.

## Important Notes
- `.env.example` định nghĩa các biến cần thiết
- Processor đang chạy job `extract-transform-load` mỗi 5 phút (có thể đổi trong `scheduler.service.ts`)
- APM index pattern mặc định: `traces-apm-*`

## Next Steps / TODO
- [ ] Add validation cho environment variables (Joi hoặc class-validator)
- [ ] Add health checks (`@nestjs/terminus`)
- [ ] Add Bull Board hoặc monitoring cho queue
- [ ] Implement DLQ (dead letter queue) cho failed jobs
- [ ] Thêm index MongoDB cho các trường query thường xuyên (`traceId`, `timestamp`, `serviceName`)
- [ ] Implement idempotency (transactionId + spanId unique index)
- [ ] Add tests (unit + e2e)
