# Web — IMPLEMENTED + TESTED

Adapter: `packages/core/src/domains/web/index.ts`

## Có thật (máy kiểm chứng 2026-11-19)

- Detect: `package.json`, `vite.config.*`, `index.html` (theo workspace root).
- Tools detect qua PATH: node v22.23.2, pnpm, bun; metadata đầy đủ cho npm/pnpm/bun.
- `project.create` → scaffold `package.json` + `index.html` + `src/main.js` + `test/smoke.test.js`.
- `build` → `node --check src/main.js` (exit 0). `test` → `node --test` (≥1 test pass).
- E2E: Universal Workspace tạo → build → test `e2e-domain-web` exit 0.

## Chưa có

- Framework adapter (React/Vue/Astro/Svelte) — scaffold là vanilla JS.
- Lighthouse / accessibility / perf budget.
- Rollback tự động cho global npm installs chạy qua DependencyManager (đã có `npm uninstall -g` derivation).

## Verify

```sh
pnpm run test   # domain.test.ts: web project create → build → test qua IPC
```

Ràng buộc: scaffold không kéo dependency ngoài — build chỉ cần node.
