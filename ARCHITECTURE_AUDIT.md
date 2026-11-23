# NEXUS Desktop — ARCHITECTURE AUDIT

Trạng thái: Phase 0 (audit). Tài liệu này mô tả hiện trạng thực tế đã kiểm chứng bằng lệnh và đọc mã nguồn. Không có thay đổi code trong Phase 0.

Ngày audit: 2026-11-19. Commit: 59e85ab. Working tree: bẩn (31 modified, 19 untracked) do các tính năng Skills / Persistent Memory / Multi-Agent / Automation vừa triển khai; audit dùng working tree hiện tại, không phải commit sạch.

## 1. Phương pháp và phạm vi

Đã chạy: `find` cây nguồn, `cat` các package.json/tsconfig, `pygount --format=summary` (bỏ qua node_modules/dist/cache), `grep` IPC/tool/UI, `command -v` cho 40+ executable, đọc docs/ARCHITECTURE.md, TECHNICAL_DECISIONS.md, SECURITY_PLAN.md, UI_DESIGN_SPEC.md. Không chạy cài đặt dependency trong Phase 0.

## 2. Quy mô codebase (pygount)

| Ngôn ngữ                                   | Files |             LOC code | Ghi chú                          |
| ------------------------------------------ | ----: | -------------------: | -------------------------------- |
| TypeScript                                 |    70 |               16.020 | core + shared + main/preload     |
| TSX                                        |    27 |                8.307 | renderer React                   |
| CSS                                        |     1 |                  643 | design tokens Tailwind v4        |
| JSON / YAML / JS / HTML / PHP / C++ / Bash |    13 |                 ~365 | config, fixture, script          |
| Markdown                                   |    10 | 0 code / 418 comment | tài liệu                         |
| Tổng                                       |   136 |               25.335 | comment ~711 (2,1%) — tỷ lệ thấp |

Tỷ lệ comment thấp là rủi ro khi mở rộng domain; cần tài liệu hóa interface mới ngay trong code.

## 3. Kiến trúc hiện tại

Process model (docs/ARCHITECTURE.md:3): Electron main (CJS) + preload sandbox (`contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`) + renderer React. Core TypeScript chạy trong main, giao tiếp với renderer qua IPC một chiều request/response + một event channel `nexus:event`.

Luồng request: renderer `lib/api.ts:call()` → `window.nexus.invoke` (preload/index.ts) → `apps/desktop/src/main/ipc.ts` validate zod → `Core.request(method, params)` (`packages/core/src/index.ts:417`) → switch 100 channel → manager → Store/Node builtins → event stream về renderer.

- `packages/shared/src/ipc.ts`: 100 channel, kèm allowlist ở cuối file.
- `packages/shared/src/ipc-schemas.ts`: zod schema cho từng channel.
- `apps/desktop/src/preload/index.ts`: bridge tối giản `invoke`, `onEvent`, `onWindowState`; không lộ Node API.
- `packages/shared/src/events.ts`: discriminated union `NexusEvent`, stream agent/tool/terminal.

Bundle: pnpm workspace (`apps/*`, `packages/*`), electron-vite, electron-builder. `engines.node >= 22`, thực tế Node 22.23.2. Strict mode bật: `strict`, `noUncheckedIndexedAccess`, `noImplicitOverride`, `noFallthroughCasesInSwitch` (tsconfig.base.json).

## 4. Module lõi và điểm tái sử dụng

| Module                                                                             | Vai trò                                                                                                                                                  | Điểm tái sử dụng cho Universal Platform                                                                                         |
| ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `packages/core/src/index.ts` (Core)                                                | 100-channel dispatch, vòng đời app                                                                                                                       | Cần cơ chế dispatch mở rộng (namespace domain) thay vì chỉ switch khổng lồ                                                      |
| `agent.ts` (~4.200 dòng, `AgentRuntime` tại :781)                                  | Plan/tool loop, subagent, approval, orchestrator, automation runner                                                                                      | Domain-aware agent nên dùng subagent có sẵn (`delegate_task`, `delegate_parallel`, `startSubagent` tại :2192) thay vì agent mới |
| `tools.ts` (`ToolRegistry` :752, 57 tool)                                          | Đăng ký tool, `ToolDefinition`/`ToolContext` (:731-750), `detectStack`, `run_build`, `run_tests`, `install_dependencies`, `inspect_package` (:1710-1830) | Đây là nền cho Universal Tool Registry; cần tách metadata (id/domain/platform/healthCheck) khỏi implement                       |
| `security.ts` (`decidePermission` :57, `dangerousCommand` :45)                     | 5 mức risk read/write/exec/network/destructive, allow/ask/deny                                                                                           | Dùng làm permission gate cho mọi domain tool, kể cả cài dependency                                                              |
| `providers.ts` (`Providers` :342)                                                  | 27 provider kind, adapter streaming, text-tool fallback, flavor registry (TD-06a)                                                                        | Giữ nguyên; domain agent chỉ chọn model, không sửa adapter                                                                      |
| `mcp.ts` / `mcp_oauth.ts`                                                          | MCP stdio + OAuth, tool namespaced `mcp__server__tool`, risk network                                                                                     | Mẫu adapter/plugin cho tool ngoài                                                                                               |
| `store.ts` (`Store` :320)                                                          | node:sqlite, WAL, foreign_keys=ON, migration idempotent, 16+ bảng                                                                                        | Thêm bảng domain/environment/tool state bằng migration mới, không đổi schema cũ                                                 |
| `workspace.ts` (`Workspace`/`WorkspaceManager` :115/:497)                          | Sandbox path, file index, bounded tree, git                                                                                                              | ProjectManager của từng domain nên đứng trên Workspace, không truyền path tự do                                                 |
| `terminal.ts` / `tools.ts:623` (`TerminalManager`, `ProcessManager`)               | PTY `script(1)` + process nền, event `terminal.output`                                                                                                   | Dùng cho build/test/simulator/serial monitor; không tự spawn process rời rạc                                                    |
| `browser.ts`, `cron.ts`, `memory.ts`, `git.ts`, `watcher.ts`                       | Browser automation, cron 5-field, MEMORY.md/USER.md, git engine, file watcher                                                                            | Đã tested; tái sử dụng thay vì viết lại                                                                                         |
| Renderer `kernel/index.ts`                                                         | Cordis DI: `api`, `query`, `store`, `mcp`; plugin realtime/MCP                                                                                           | Điểm cắm workspace UI dạng plugin, tránh import global                                                                          |
| `pages/` (5), `SettingsPage.tsx` (~1.350 dòng), `SettingsExtras.tsx` (~1.170 dòng) | Home/Chat/Scheduled/Plugins/Settings + 25 section                                                                                                        | Mở rộng bằng route/page đăng ký; không nhét tiếp vào switch `App.tsx:83`                                                        |

## 5. Điểm mạnh cần giữ

1. Biên giới IPC chặt: allowlist + zod + preload tối giản + event union — chèn domain tool mới phải đi qua cùng biên giới này.
2. Core không có dependency runtime npm (`packages/core/package.json` dependencies rỗng); mọi tích hợp tool ngoài đều là CLI tùy chọn — rất hợp với yêu cầu "không cài hàng trăm công cụ".
3. Permission gate tập trung + approval UI + redaction + workspace sandbox — đáp ứng phần lớn yêu cầu an toàn Phase 3/13.
4. Có sẵn subagent thực (đã probe chạy xong), memory bền vững, cron/webhook, browser automation — không cần xây lại.
5. Verification discipline: typecheck/lint/45 unit tests/11 E2E/build/probe Electron thực.

## 6. Rủi ro và khoảng trống kiến trúc

| #   | Vấn đề                                                                                                                                                                                                       | Bằng chứng                                   | Hướng xử lý trong plan                                                                               |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| R1  | `Core.request` là switch đơn 100 case; mỗi domain tool thêm 5 lớp (type, zod, allowlist, dispatch, wrapper)                                                                                                  | `ipc.ts:417`, `:472-540`                     | Thêm namespace `domain.<id>.<action>` + registry handler, giữ switch cũ làm fallback tương thích     |
| R2  | `tools.ts` một file đăng ký 57 tool, `agent.ts` ~4.200 dòng                                                                                                                                                  | `tools.ts:810`, `agent.ts:781`               | Tách adapter theo domain; `ToolRegistry` nhận metadata mới, AgentRuntime chỉ giữ một intercept point |
| R3  | UI switch route chỉ 4 page, SettingsPage/SettingsExtras đã rất lớn                                                                                                                                           | `App.tsx:83`, `SettingsPage.tsx:44-73`       | Workspace registry + page component riêng; không mở rộng file hiện tại quá mức                       |
| R4  | Tài liệu schema lỗi thời: `docs/DATABASE_SCHEMA.md` không liệt kê `agent_skills`, `automations`                                                                                                              | so sánh headings docs với `store.ts:189-217` | Cập nhật tài liệu trong Phase 1, không đổi bảng cũ                                                   |
| R5  | Bề mặt trùng chức năng: `ScheduledPage.tsx` vs AutomationPanel trong `SettingsExtras.tsx:72`, `PluginsPage.tsx` vs `McpPanel`, `lib/mcp.ts` vs `kernel/plugin-mcp.ts` (plugin bọc lib, không trùng nội dung) | grep UI                                      | Ghép dần về một nguồn dữ liệu; không xóa module đang chạy                                            |
| R6  | File rác chưa tracked trong `apps/desktop/` (`giai_toan.php`, `hello.txt`, `loop_advanced.cpp`), `.agent.ts.kate-swp`, `cache/`, tarball                                                                     | `git status --short`                         | Dọn dẹp ở PR riêng có xác nhận; không xóa trong Phase 0                                              |
| R7  | Comment 2,1%                                                                                                                                                                                                 | pygount                                      | Bắt buộc JSDoc/interface comment cho module domain mới                                               |

## 7. Môi trường máy này (căn cứ DEPENDENCY_MATRIX)

Ubuntu 26.04.1 LTS x86_64, kernel 7.0.0. Có: git, gcc, g++, clang, cmake, ninja, make, cargo, rustc, go, javac, python3 3.14.9, pip3, uv, npm, pnpm, bun, docker, gdb, arduino-cli, platformio/pio, nmap, ffmpeg. Package manager: apt, flatpak. Không có: dotnet, podman, kubectl, terraform, ansible, QEMU ARM, openocd, esptool, ESP-IDF (`idf.py`), Wireshark/tshark, ZAP, semgrep, trivy, gitleaks, bandit, Godot, Blender. Đây là dữ liệu thực tế kiểm chứng bằng `command -v`, không phải giả định.

## 8. Cập nhật sau Bước 2–3 (triển khai)

Đã thêm lớp domain mà không sửa kiến trúc cũ: `packages/core/src/domain/` (types, registry, environment, dependency, runner, build, test, simulation, debug, project, artifacts) và `packages/core/src/domains/{web,systems}/`. Core dispatch có namespace `domain.*` (8 channel) cạnh 100 channel cũ; renderer có `pages/DomainPage.tsx` qua route `domain` và rail icon. `Core.request` vẫn là switch cũ + registry handler riêng cho domain, không xóa module nào.

Hai lỗi phát hiện khi probe thực và đã sửa: (1) DependencyManager đọc static `tool.availability` thay vì snapshot môi trường nên báo tool có sẵn là missing; (2) regex tên executable thiếu dấu `+` nên `g++` bị bỏ qua. Cả hai có test hồi quy.

Chi tiết trạng thái xem DOMAIN_SUPPORT_MATRIX.md; bằng chứng chạy thực xem IMPLEMENTATION_PLAN.md.

## 9. Kết luận audit

Không có lý do kỹ thuật để thay kiến trúc Electron + TypeScript core + SQLite + IPC zod đang chạy. Universal Development Environment nên được xây như một lớp module mới (Domain Engine + Tool Adapter + Dependency Manager) cắm vào các điểm mở rộng đã có, với UI workspace đăng ký qua kernel/route. Mọi tool ngoài phải được phát hiện trước, ghi metadata, đi qua permission gate, và chỉ cài khi người dùng xác nhận. Chi tiết thực hiện xem IMPLEMENTATION_PLAN.md; mức hỗ trợ từng domain xem DOMAIN_SUPPORT_MATRIX.md.
