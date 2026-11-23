# NEXUS — IMPLEMENTATION PLAN (Universal Multi-Domain Development Platform)

Trạng thái: Bước 2–4 đã triển khai và kiểm chứng (xem mục "Cập nhật tiến độ" cuối file). Mọi bước đều phải giữ nguyên typecheck/lint/test/build/E2E xanh trước khi chuyển bước tiếp theo.

## Nguyên tắc thiết kế (không thương lượng)

1. Không thay thế kiến trúc Electron + TypeScript core + SQLite + IPC zod đang chạy.
2. Không xóa module đang hoạt động; mở rộng qua registry/interface/plugin.
3. Không tool giả: mọi capability phải gọi executable thật hoặc adapter có implement thật; nếu thiếu tool thì báo "requires external installation", không hiển thị thành công.
4. Không hardcode đường dẫn executable: mọi tool đi qua `command -v`/PATH + registry metadata.
5. Không cài dependency hàng loạt: detect → propose → xác nhận người dùng → cài domain cụ thể → verify → log → rollback khi có thể.
6. Không deploy/cloud/khác thao tác tác động hệ thống thật khi chưa xác nhận; security chỉ thử hệ thống người dùng sở hữu/ủy quyền.
7. Core vẫn không thêm dependency runtime npm; tool ngoài là CLI tùy chọn do DependencyManager quản lý.
8. TypeScript strict (`noUncheckedIndexedAccess`), interface/adapter/provider/test cho mỗi module mới; không file khổng lồ.

## Bước 1 — Audit (đã xong)

Đầu ra: ARCHITECTURE_AUDIT.md, IMPLEMENTATION_PLAN.md, DEPENDENCY_MATRIX.md, DOMAIN_SUPPORT_MATRIX.md. Không sửa source. Xác nhận các điểm mở rộng: `Core.request` (`index.ts:417`), `ToolRegistry` (`tools.ts:752`), `AgentRuntime.executeTool` (`agent.ts:817`), `NexusEvent` (`events.ts:10`), kernel DI (`kernel/index.ts`), route switch (`App.tsx:83`).

## Bước 2 — Domain Engine + Tool Registry (Phase 1 + 14)

Tạo module mới, không đụng logic cũ:

```
packages/core/src/domain/
  types.ts            # DomainId, DomainModule, DomainCapability, DomainContext
  registry.ts         # DomainRegistry: register/get/list, id duy nhất, version
  detector.ts         # DomainDetector: detect(workspace) -> DomainMatch[]
  environment.ts      # EnvironmentManager: OS/arch/shell/PATH/tool availability
  dependency.ts       # DependencyManager: plan/install/verify/rollback + audit log
  project.ts          # ProjectManager: scaffold/build/test/simulate/delegate
  build.ts            # BuildManager: profile, runner, artifact capture
  test.ts             # TestManager: parse kết quả, exit code, log
  simulation.ts       # SimulationManager: capability-aware, không giả board
  debug.ts            # DebugManager: adapter GDB/OpenOCD khi có
  artifacts.ts        # ArtifactManager: firmware, coverage, report, log
packages/core/src/domain/adapters/base.ts   # BaseDomainAdapter
packages/core/src/domains/<id>/index.ts      # một domain = một module độc lập
```

Interface tối thiểu (mô tả, chưa code):

```ts
interface DomainModule {
  id: string
  label: string
  platforms: Array<'linux' | 'darwin' | 'win32'>
  tools: ToolMetadata[] // id, name, domain, executable, version, capabilities, ...
  detect(ctx: DomainContext): DomainMatch[]
  plan(ctx: DomainContext): DependencyPlan
  project(ctx: DomainContext, input: ProjectInput): ProjectResult
  build(ctx: DomainContext, input: BuildInput): BuildResult
  test(ctx: DomainContext, input: TestInput): TestResult
  simulate?(ctx: DomainContext, input: SimulationInput): SimulationResult
  debug?(ctx: DomainContext, input: DebugInput): DebugResult
  report(ctx: DomainContext): Report
}
```

- `ToolMetadata` bổ sung cho `ToolDefinition` hiện tại: `domain`, `executable`, `supportedPlatforms`, `dependencies`, `installationGuide`, `availability`, `permissions`, `healthCheck`. Giữ `name/description/risk/parameters/execute/summarize` tương thích 57 tool cũ.
- `DomainDetector` tái dùng `detectStack()` và `Workspace` (`tools.ts`, `workspace.ts`); không đọc toàn bộ repo (TD-09).
- IPC: thêm namespace `domain.list`, `domain.detect`, `domain.tools`, `domain.environment`, `domain.dependency.plan`, `domain.dependency.install`, `domain.action`. Đăng ký handler trong `Core` qua `Map<string, handler>`; switch cũ vẫn xử lý 100 channel hiện tại. Mọi channel mới vẫn phải có type + zod + allowlist + wrapper (bài học skill `desktop-app-feature-wiring`).
- Tool runtime: giữ một điểm intercept trong `AgentRuntime.executeTool`; tool domain gọi adapter của registry, không nhét logic tool vào agent.
- Subagent: Domain-aware agent chọn domain rồi dùng `delegate_task`/`delegate_parallel` có sẵn; không tạo agent core thứ hai.

Verification bước 2: unit test registry/detector/adapter metadata; IPC probe `domain.list/detect`; typecheck/lint/test/build/E2E xanh; 0 tool domain được coi là available nếu `command -v` trả rỗng.

## Bước 3 — Dependency Manager (Phase 13)

- `EnvironmentManager`: `process.platform`, `process.arch`, `PATH`, shell, phân biệt `python3` trong venv Hermes với `/usr/bin/python3`.
- `DependencyManager.plan()`: detect trước, trả `{installed, missing, version, source, risk, commands[]}`; pin version khi có khai báo; log vào bảng mới `dependency_events` qua migration (không đổi bảng cũ).
- Install chỉ khi IPC nhận `approved: true` kèm domain id; chạy qua `ProcessManager`/`runShell` có timeout, capture output, verify lại bằng healthCheck, ghi rollback command (apt remove / npm uninstall / uv pip uninstall…).
- Không cài tool ngoài domain đang dùng; unsupported platform → trả `unsupported` kèm lý do.

Verification: unit test plan/verify/rollback với executable giả trong temp PATH (không cài thật); E2E xác nhận UI chặn install khi chưa approve; audit log có bản ghi.

## Bước 4 — Triển khai domain theo ưu tiên (Phase 2–11)

Thứ tự ưu tiên dựa trên bằng chứng máy hiện tại (xem DEPENDENCY_MATRIX.md), không phải thứ tự trong prompt:

1. Web (Phase 6): đã có stack detection, Vite/pnpm/Playwright, app tự chạy — mở rộng adapter, không xây mới.
2. Backend/Systems (Phase 7): gcc/g++/clang/cmake/ninja/make/cargo/rustc/go/gdb có sẵn; tái dùng run_build/run_tests/analyze_errors.
3. AI/ML (Phase 5): Python/uv có; phải detect torch/transformers/ONNX trước khi nhận; không bao giờ báo training xong nếu chưa chạy thật.
4. Embedded (Phase 2): arduino-cli + platformio có; board detection/pin mapping/gpio; simulator Renode/QEMU/OpenOCD phải đánh dấu requires-install, không giả hỗ trợ mọi board.
5. Database/Data (Phase 9): node:sqlite có sẵn; PostgreSQL/MySQL/Mongo/Redis phải detect client và service riêng.
6. DevOps/Cloud (Phase 10): docker có; kubectl/terraform/ansible thiếu; chỉ sinh file/validate, deploy cần xác nhận.
7. Cybersecurity (Phase 3): nmap có; Wireshark/ZAP/semgrep/trivy/gitleaks/bandit thiếu; bật defensive/authorized-only gate, sandbox malware analysis, không attack hệ thống ngoài.
8. Game (Phase 4): Godot/Blender thiếu → adapter CLI khi có, current status requires-install/license.
9. Desktop/OS (Phase 11): Electron/CMake/GDB/QEMU; kernel/devdriver chỉ hỗ trợ VM khi có QEMU.
10. Mobile (Phase 8): Linux này không có Android SDK/Xcode → detect OS trước; iOS native trên Linux = unsupported.

Mỗi domain bước 4 phải có: adapter file, tool metadata, IPC action, unit test, integration test thật (tạo project tạm → build/test → collect log), bảng status trong DOMAIN_SUPPORT_MATRIX.md cập nhật sau khi test. Không đánh dấu done nếu chỉ có UI.

## Bước 5 — Domain-aware Agent (Phase 12)

- Intent classifier tái dùng provider/model hiện tại: prompt + domain registry → selected domain; ghi `domain.selected` event.
- Chọn tool theo `ToolMetadata.capabilities` + permission gate; lập kế hoạch bằng plan protocol có sẵn; thực thi qua subagent chuyên môn.
- Error handling dùng retry/backoff và verification loop hiện có; report gồm domain, tool, exit code, artifact path, status thật.

## Bước 6 — UI (Phase 15)

- Thêm Universal Workspace page đăng ký qua `App.tsx` route map + kernel service; Domain Explorer lấy `domain.list/detect` từ IPC.
- Workspace con (Embedded/Cybersecurity/Game/AI-ML/Web/Mobile/Systems/DevOps/Database) là component riêng trong `components/workspaces/`, dùng chung `Group/Button/Input` và design tokens; mỗi trang gọi IPC thật, không trang rỗng.
- Build Center / Debug Center / Simulation Center / Dependency Manager dùng chung artifact + event stream (`nexus:event`).
- Gộp dần bề mặt trùng (ScheduledPage vs AutomationPanel, PluginsPage vs McpPanel) ở PR riêng; không xóa trong cùng PR mở rộng.

## Bước 7 — Testing & docs (Phase 16–17)

- Unit: registry, detector, dependency plan, adapter metadata, permission policy.
- Integration: với executable thật đã có (gcc, cmake, cargo, go, pnpm, uv, arduino-cli, platformio, docker, nmap) trong temp project; với tool thiếu chỉ test trạng thái `requires-install`.
- E2E: mở từng workspace, detect tool thật, chạy 1 build/test, assert artifact/log; screenshot lưu scratch.
- Tailor docs theo cây `docs/architecture/`, `docs/domains/`, `docs/embedded/`, ... như yêu cầu, ghi rõ Implemented / Tested / Partially supported / Requires external installation / Requires license / Unsupported.

## Bước 8 — Báo cáo tính năng thực

Xuất bảng trạng thái từ DOMAIN_SUPPORT_MATRIX.md sau khi chạy tests; chỉ grep/command -v và exit code làm bằng chứng. Không dùng từ "hoàn thành" cho phần chưa có integration test.

## Cổng kiểm soát mỗi bước

```sh
pnpm run typecheck && pnpm run lint && pnpm run test && pnpm run build && xvfb-run -a npx playwright test
```

Nếu một cổng đỏ: dừng, sửa, chạy lại; không chuyển bước. Sau mỗi build, restart app (`pnpm start`) và xác nhận `NEXUS Desktop ready` + `renderer ready` trong `~/.config/NEXUS Desktop/logs/main.log`.

## Cập nhật tiến độ (sau khi triển khai)

- Bước 2 (Domain Engine + Tool metadata) — DONE: `packages/core/src/domain/{types,registry,environment,dependency,runner,build,test,simulation,debug,project,artifacts}.ts`, adapter `packages/core/src/domains/{web,systems,aiml,database,devops,security,embedded,game,mobile,desktop}/index.ts`, 8 IPC channel `domain.*`, UI `pages/DomainPage.tsx` + route `domain` + rail button.
- Bước 3 (Dependency Manager) — DONE: plan/approve/verify/log + **auto-rollback khi verify-after-install fail** (gồm audit log action=`rollback`). Rollback derive tự động cho apt/pip(user)/uv/npm-g (`domain/rollback.ts`); manager khác (cargo/flatpak/dnf…) còn null — không đoán. requires-root → manual command + rollbackCommand ghi trong log. 3 unit tests; tool metadata 16 field.
- Bước 4 — DONE mức adapter cho cả 10 domain ưu tiên. IMPLEMENTED+TESTED (lệnh thật): Web, Systems, AI/ML, Database (node:sqlite: schema apply + `widgets=3`), DevOps (`docker compose config --quiet` exit 0 + YAML strict parse), Cybersecurity (`nmap -Pn -p 18766 127.0.0.1` exit 0, loopback authorized-only), Desktop/OS (Qt 6 Widgets: cmake build + `QT_QPA_PLATFORM=offscreen ctest` → passed). PARTIAL/REQUIRES INSTALL (honest fail, không fake): Embedded (pio platform có, toolchain `~/.platformio/packages` trống → build/test trả `requires-toolchain-install`, cần xác nhận trước khi tải), Game (scaffold Godot 4 thật; test trả `requires-install` vì godot không có PATH), Mobile (scaffold Android thật; adb/SDK MISSING; iOS trên Linux = UNSUPPORTED).
- Bước 6 — Universal Workspace cơ bản DONE (Domain Explorer 10 domain data-driven, tools, dependency manager, build/test center, ô Detect domain chọn domain từ prompt). 14 workspace chuyên sâu chưa có.
- Bước 5 — ĐÃ BẮT ĐẦU (deterministic, honest): `domain/intent.ts` phân loại prompt EN/VI + workspace markers → top domain (confidence, reasons); `AgentRuntime` emit event `domain.selected` khi task start và chèn "Domain hint" vào system prompt khi confidence ≥0.5; IPC `domain.intent` (+`api.domain.intent`); Universal Workspace có ô Detect domain. **Tool selection theo capability**: `domain/capabilities.ts` map 54 builtin tools + affinity của 10 domain; `filterTools` re-rank (KHÔNG pruning) để tool hợp domain vào budget trước; contextUsage + runTask đều dùng selectedDomain. CHƯA LÀM: provider-based classifier (cần provider thật để probe), `domain.action` chạy qua subagent chuyên môn theo domain.
- Kiểm chứng: 64 unit tests pass (8 domain + 5 intent + 3 rollback + 3 capabilities), 12/12 E2E pass (Universal Workspace tạo/build/test project thật trên 4 domain: Web/Systems/AI-ML/Desktop-Qt, 17.3s; kèm assert `domain.intent` → aiml), typecheck/lint/build exit 0. countTests đã hỗ trợ output pytest (`N passed`) và ctest (`tests passed, N tests failed out of M`).
- Bước 7 & 17 (docs) — DONE mức repo: `docs/architecture/domain-engine.md` (luồng, honesty rules, IPC), `docs/domains/README.md` (index status) + 10 trang status thật từng domain. Bỏ nhánh `docs/embedded/` riêng (gộp vào `docs/domains/embedded.md`).
- Chưa làm: provider-based intent classification + tool-selection theo capability (Bước 5 phần còn lại), rollback derive cho cargo/flatpak, docs ngoài repo (tài liệu người dùng cuối).

## Ước lượng và phạm vi lần này

Phase 0 đã xong; Bước 2–3 và phần đầu Bước 4/6 đã triển khai như mục "Cập nhật tiến độ". Mỗi domain tiếp theo nên là một PR/turn riêng theo thứ tự ưu tiên ở trên, với integration test thật trước khi đổi trạng thái.
