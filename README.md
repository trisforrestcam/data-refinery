# DataRefinery

ETL pipeline nhỏ gọn chạy trên NestJS: pull APM traces từ Elasticsearch, transform & refine, rồi persist vào MongoDB qua cron job (BullMQ).

## Kiến trúc tổng quan

```
Scheduler (BullMQ cron) → Processor → Extractor (ES) → Transformer → Loader (MongoDB)
```

| Module | Vai trò |
|--------|---------|
| `extractor` | Query `traces-apm-*` từ Elasticsearch |
| `transformer` | Map raw ECS fields → `RefinedDataDto` |
| `loader` | Bulk write vào MongoDB qua repository pattern |
| `scheduler` | Đăng ký cron job 5 phút/lần bằng `upsertJobScheduler` |

## Yêu cầu hệ thống

- Node.js 20+
- MongoDB (local hoặc Docker)
- Redis (local hoặc Docker — dùng cho BullMQ)
- Elasticsearch với APM indices (`traces-apm-*`)

## Cài đặt

```bash
# 1. Copy env
cp .env.example .env

# 2. Cài dependencies
npm install

# 3. Chạy dev mode (watch)
npm run start:dev
```

## Scripts hữu ích

```bash
npm run typecheck      # Kiểm tra TypeScript không emit
npm run test           # Unit tests (Jest)
npm run test:watch     # Watch mode cho tests
npm run test:cov       # Coverage report
npm run test:e2e       # End-to-end tests
```

## Cấu trúc thư mục

```
src/
├── config/              # Env configs (registerAs pattern)
├── common/
│   ├── constants/       # Queue names, scheduler IDs
│   └── repositories/    # BaseRepository<T> generic
└── modules/
    ├── extractor/       # ES query + DTOs
    ├── transformer/     # ECS field mapping
    ├── loader/          # MongoDB schema + repository + bulkWrite
    └── scheduler/       # BullMQ queue + processor
```

## Convention quan trọng

1. **Config:** Luôn dùng `registerAs` + `forRootAsync` — không hardcode credentials.
2. **BullMQ:** Dùng `upsertJobScheduler` (thay vì repeatable jobs cũ). Processor extends `WorkerHost`.
3. **MongoDB:** Persistence qua repository extends `BaseRepository<T>`. Schema dùng `@Schema()` + `@Prop()`.
4. **ES Client v9:** Query params truyền flat (không dùng `body` wrapper).
5. **Validation:** DTOs input dùng `class-validator`. `ValidationPipe` được bật global trong `main.ts`.

## Mở rộng

Xem `AGENTS.md` hoặc `TODO` trong code để biết các tính năng đang chờ implement (health checks, DLQ, monitoring, v.v.).
