# NEXUS — Domain Engine (kiến trúc & vận hành)

Trạng thái: IMPLEMENTED + TESTED (xem [../../DOMAIN_SUPPORT_MATRIX.md](../../DOMAIN_SUPPORT_MATRIX.md)). Tài liệu này mô tả **cái đang chạy**, không phải kế hoạch. Cập nhật khi đổi code/flow.

## Luồng tổng quan

```
Renderer (Universal Workspace)          Core (packages/core)                     OS
        api.domain.*                      DomainRegistry ──► BaseDomainAdapter ──► runner.ts runCommand
            │  IPC zod                     │  (domains/<id>/index.ts)                 │ spawn /bin/sh
            ▼                              ▼                                         ▼
   shared/ipc-schemas.ts         domain/detect|create|build|test            executable thật
   shared/ipc.ts (allowlist)     domain/dependency.ts (plan/approve/install/verify/rollback, log)
```

Điểm mở rộng: `DomainModule` interface (`domain/types.ts`), `BaseDomainAdapter` (`domains/base.ts`), `ToolMetadata` đủ 16 field (gồm `rollbackCommand`).

## Thành phần

| Thành phần              | File                                                 | Vai trò                                                                                                                                                                                                                                                                               |
| ----------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DomainRegistry          | `packages/core/src/domain/registry.ts`               | Đăng ký theo id duy nhất (regex `^[a-z][a-z0-9-]*$`), variadic `standardDomains`                                                                                                                                                                                                      |
| EnvironmentManager      | `packages/core/src/domain/environment.ts`            | Probe `command -v` + `<exe> --version`, cache 30s, PATH snapshot                                                                                                                                                                                                                      |
| DependencyManager       | `packages/core/src/domain/dependency.ts`             | plan → approve gate → install (timeout, capture) → verify bằng re-probe; **auto-rollback** khi verify fail (command từ `rollbackCommand` explicit hoặc `deriveRollbackCommand`) + audit log `dependency_events` (actions: `install`, `manual-required`, `rollback`)                   |
| Rollback derivation     | `packages/core/src/domain/rollback.ts`               | `deriveRollbackCommand`: apt→`apt-get remove`, pip user/plain→`pip uninstall`, uv→`uv pip uninstall`, npm -g→`npm uninstall -g`, cargo→`cargo uninstall`, dnf/yum→`dnf remove`, pacman→`pacman -R`, brew→`brew uninstall`, zypper→`zypper remove`; không nhận ra → `null`, không đoán |
| Runner                  | `packages/core/src/domain/runner.ts`                 | `runCommand` (timeout, cắt output), `countTests` parse pytest / ctest / node --test                                                                                                                                                                                                   |
| Intent router           | `packages/core/src/domain/intent.ts`                 | Deterministic classifier keyword EN/VI + workspace markers → top match confidence/reasons; event `domain.selected`; IPC `domain.intent`; Domain hint trong system prompt khi confidence ≥ 0.5                                                                                         |
| Tool capability re-rank | `packages/core/src/domain/capabilities.ts`           | TOOL_CAPABILITIES (54 builtin tools) + DOMAIN_CAPABILITY_AFFINITY (10 domain); `filterTools` re-rank trước budget slice — KHÔNG pruning; selectedDomain truyền vào contextUsage + runTask                                                                                             |
| Domain UI               | `apps/desktop/src/renderer/src/pages/DomainPage.tsx` | Domain Explorer + ô Detect domain + Dependency Manager + Build/Test — data-driven từ `domain.list`                                                                                                                                                                                    |

## Honesty rules (không thương lượng)

1. Mọi capability gọi executable thật qua PATH; thiếu → `requires-install` / `requires-toolchain-install` + reason, không giả success.
2. Cài dependency: cần `approved: true`; cần root → trả `requires-root` + `manualCommand`, audit log nhưng **không tự sudo**.
3. Không cài toolchain tự động khi chưa được xác nhận (Embedded: `~/.platformio/packages` trống là lý do build dừng).
4. Security domain chỉ quét 127.0.0.1 (authorized-only).
5. iOS trên Linux = UNSUPPORTED; mỗi domain ghi rõ thứ thực sự chạy được, xem `docs/domains/`.

## IPC (namespace `domain.*`)

`domain.list`, `domain.detect`, `domain.environment`, `domain.tools`, `domain.intent`, `domain.dependency.plan`, `domain.dependency.install`, `domain.dependency.events`, `domain.action` (project.create/build/test/simulate/debug/report). Wiring 5 lớp: `shared/ipc.ts` (types + allowlist) → `shared/ipc-schemas.ts` (zod) → `core/index.ts` (handler) → `renderer/lib/api.ts`.

## Verify

```sh
pnpm run typecheck && pnpm run lint && pnpm run test && pnpm run build
xvfb-run -a npx playwright test
```

Kết quả gần nhất: 64/64 unit (domain 8 + intent 5 + rollback 3 + capabilities 3 + còn lại), 12/12 E2E (Universal Workspace build/test thật Web/Systems/AI-ML/Desktop-Qt + assert `domain.intent`→aiml).
