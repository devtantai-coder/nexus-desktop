# DevOps & Cloud — IMPLEMENTED + TESTED (scope Docker/Compose/YAML)

Adapter: `packages/core/src/domains/devops/index.ts`

## Có thật (2026-11-19)

- docker 29.8.1 AVAILABLE, compose plugin v5.5.1, **daemon OK**.
- `project.create` → `Dockerfile` (node:22-alpine) + `docker-compose.yml` + `.github/workflows/ci.yml`.
- `build` → `docker compose config --quiet` (exit 0 thật, validate compose offline — không build/pull).
- `test` → YAML strict parse (`yaml ok`) của mọi `*.yml/*.yaml` + compose. Unit IPC test pass.

## Chưa có

- kubectl, terraform, ansible, helm, podman: MISSING (cài cần xác nhận; nguồn cài trong DEPENDENCY_MATRIX.md).
- `docker build` chạy thật (cần pull base image — chỉ chạy khi user xác nhận).
- Deploy cloud thật (cấm trước khi user approve + credentials thật).
- Log/monitor/alerting adapter.

## Verify

```sh
pnpm run test   # domain.test.ts: devops → docker compose config → yaml parse
```

Ràng buộc: scaffold không tự deploy; không credentials trong repo; deploy/gate thủ công.
