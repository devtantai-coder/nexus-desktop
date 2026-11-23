# Database & Data — IMPLEMENTED + TESTED (scope node:sqlite)

Adapter: `packages/core/src/domains/database/index.ts`

## Có thật (2026-11-19)

- Tools: mysql client 11.8.6-MariaDB (service CHƯA verify), mongosh 2.11.1 (service CHƯA verify), redis-cli 8.0.5 (service CHƯA verify) — **client có sẵn, service thật chưa chạy**, báo đúng vậy.
- node:sqlite BUILTIN (Node 22, ExperimentalWarning) — dùng làm engine test offline.
- Detect: `schema.sql`, `migrations/`, `prisma/`, `drizzle.config.ts`, `*.sql`.
- `project.create` → `schema.sql` (bảng `widgets`) + `check.mjs`.
- `build` → apply schema qua `node:sqlite` (`schema ok`); `test` → `node check.mjs` → in `widgets=3`, assert 3 rows. Unit IPC test pass.
- psql, sqlite3 CLI: MISSING (`apt postgresql-client` / `apt-get install -y sqlite3`, cần root).

## Chưa có

- Connection thật + query latency/timeout adapter cho MySQL/PG/Mongo/Redis (cần service chạy).
- Migration runner (up/down), schema diff, EXPLAIN adapter.
- DuckDB/Spark/dbt/ClickHouse (CHƯA KIỂM TRA).

## Verify

```sh
pnpm run test   # domain.test.ts: database → build (schema apply) → test (widgets=3)
```

Ràng buộc: không claim "DB production ready" — mọi check chỉ chạy trên `:memory:` SQLite.
