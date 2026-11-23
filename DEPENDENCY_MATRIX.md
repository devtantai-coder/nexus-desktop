# NEXUS — DEPENDENCY MATRIX

Trạng thái: audit thực tế bằng `command -v` và `<tool> --version` trên Ubuntu 26.04.1 LTS x86_64 (kernel 7.0.0), Node 22.23.2, pnpm 12.21.0, Python 3.14.9. Không tool nào được cài trong Phase 0. `pygount` được cài chỉ để đo LOC, không phải dependency của dự án.

Chú giải trạng thái:

- AVAILABLE: có executable trong PATH, đã detect phiên bản.
- MISSING: không có trong PATH; phải cài có xác nhận.
- BUILTIN: có trong core/runtime (node:sqlite, node:child_process…).
- LICENSE: cần license/cài đặt ngoài (Unity/Unreal/iOS).
- UNSUPPORTED: không áp dụng cho OS này (ví dụ Xcode trên Linux).

Nguyên tắc install (Phase 13): detect → plan → xác nhận → install domain-specific → verify → log → rollback; pin version; không bulk install. Package manager hiện có: apt (/usr/bin/apt), flatpak (/usr/bin/flatpak). Không có dnf/pacman/zypper/brew trên máy này.

## 1. Dependency runtime của ứng dụng

| Thành phần                                | Nguồn              | Trạng thái | Ghi chú                                                                        |
| ----------------------------------------- | ------------------ | ---------- | ------------------------------------------------------------------------------ |
| Electron 45.3.2                           | pnpm devDependency | AVAILABLE  | main/preload/renderer, packaged bởi electron-builder 26.18                     |
| React 19.3.1 / react-dom                  | pnpm               | AVAILABLE  | renderer                                                                       |
| TypeScript 5.9.3                          | pnpm               | AVAILABLE  | strict + noUncheckedIndexedAccess                                              |
| zod 4.6.7                                 | pnpm               | AVAILABLE  | IPC schema                                                                     |
| @tanstack/react-query 5.107               | pnpm               | AVAILABLE  | renderer query cache                                                           |
| zustand 5.1                               | pnpm               | AVAILABLE  | app store                                                                      |
| cordis 4.0.0-rc.13                        | pnpm               | AVAILABLE  | renderer DI kernel                                                             |
| lucide-react / Radix UI / Tailwind v4     | pnpm               | AVAILABLE  | UI                                                                             |
| Playwright 1.65                           | pnpm               | AVAILABLE  | E2E thực, dùng system Electron                                                 |
| node:sqlite, node:child_process, node:net | Node builtin       | BUILTIN    | core không có runtime npm dep (`packages/core/package.json` dependencies = {}) |

## 2. Tool hệ thống theo domain

| Domain        | Tool / executable                                             | Trạng thái                                | Phiên bảndetect                                                                                             | Nguồn cài đặt khi MISSING    | Risk                     |
| ------------- | ------------------------------------------------------------- | ----------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ---------------------------- | ------------------------ |
| Systems / Web | git                                                           | AVAILABLE                                 | 2.53.0                                                                                                      | apt                          | read                     |
| Systems       | gcc, g++                                                      | AVAILABLE                                 | 15.2.0                                                                                                      | apt                          | exec                     |
| Systems       | clang                                                         | AVAILABLE                                 | 21.1.8                                                                                                      | apt                          | exec                     |
| Systems       | cmake                                                         | AVAILABLE                                 | 4.2.3                                                                                                       | apt                          | exec                     |
| Systems       | ninja                                                         | AVAILABLE                                 | 1.13.2                                                                                                      | apt                          | exec                     |
| Systems       | make                                                          | AVAILABLE                                 | 4.4.1                                                                                                       | apt                          | exec                     |
| Systems       | gdb                                                           | AVAILABLE                                 | 17.1                                                                                                        | apt                          | exec/debug               |
| Systems/Rust  | cargo, rustc                                                  | AVAILABLE                                 | 1.99.1                                                                                                      | rustup/cargo                 | exec                     |
| Systems/Go    | go                                                            | AVAILABLE                                 | (không in --version ngắn)                                                                                   | apt/toolchain                | exec                     |
| Systems/Java  | javac                                                         | AVAILABLE                                 | 21.0.13                                                                                                     | apt                          | exec                     |
| Systems/.NET  | dotnet                                                        | MISSING                                   | —                                                                                                           | apt feed/Microsoft           | exec                     |
| Web/JS        | node, npm, pnpm, bun                                          | AVAILABLE                                 | 22.23.2 / — / 12.21.0 / —                                                                                   | corepack/npm                 | exec/network             |
| Web/Python    | python3, pip3, uv                                             | AVAILABLE                                 | 3.14.9 / — / 0.13.9                                                                                         | apt/uv installer             | exec/network             |
| Web/Python    | pip3 trong venv Hermes                                        | AVAILABLE                                 | Python 3.14.9 từ venv                                                                                       | dùng đúng PATH               | exec                     |
| Embedded      | arduino-cli                                                   | AVAILABLE                                 | (không in --version ngắn)                                                                                   | apt/official tarball         | exec                     |
| Embedded      | platformio / pio                                              | AVAILABLE                                 | 6.2.0; platforms espressif32 8.0.0 + ststm32 20.0.0 CÀI; `~/.platformio/packages` TRỐNG → toolchain chưa có | pip/uv                       | exec                     |
| Embedded      | esptool.py, idf.py (ESP-IDF)                                  | MISSING                                   | —                                                                                                           | pip + ESP-IDF installer      | exec                     |
| Embedded      | openocd, qemu-system-arm, arm-none-eabi-gcc                   | MISSING                                   | —                                                                                                           | apt                          | exec/debug               |
| Desktop       | qmake6 / Qt 6                                                 | AVAILABLE                                 | 6.10.2 (Qt6Widgets cmake OK)                                                                                | apt qt6-base-dev             | exec/compile             |
| Desktop       | qemu-system-x86_64                                            | AVAILABLE                                 | —                                                                                                           | apt qemu-system-x86          | exec                     |
| Desktop       | electron CLI                                                  | NOT IN PATH (app chạy từ node_modules)    | —                                                                                                           | pnpm devDependency           | exec                     |
| Embedded Sim  | Wokwi (CLI/cloud), SimulIDE, simavr                           | MISSING                                   | —                                                                                                           | npm/apt/build từ source      | exec                     |
| DevOps        | docker                                                        | AVAILABLE                                 | 29.8.1; compose plugin v5.5.1; daemon OK                                                                    | apt                          | exec (cần xác nhận)      |
| DevOps        | podman, kubectl, helm, terraform, ansible                     | MISSING                                   | —                                                                                                           | apt/official repo            | exec/network             |
| DevOps        | nginx                                                         | CHƯA KIỂM TRA                             | —                                                                                                           | apt                          | exec                     |
| Security      | nmap                                                          | AVAILABLE                                 | 7.98; loopback scan 127.0.0.1 exit 0                                                                        | apt                          | network (chỉ authorized) |
| Security      | tshark/wireshark, ZAP, semgrep, trivy, gitleaks, bandit, YARA | MISSING                                   | —                                                                                                           | apt/pip/npm/official         | network/exec             |
| AI/ML         | torch                                                         | AVAILABLE (import thật 2.13.0+cpu)        | —                                                                                                           | uv pip (project venv)        | exec/network             |
| AI/ML         | transformers                                                  | AVAILABLE (import thật 5.14.1)            | —                                                                                                           | uv pip                       | exec/network             |
| AI/ML         | onnxruntime                                                   | AVAILABLE (import thật 1.28.0)            | —                                                                                                           | uv pip                       | exec                     |
| AI/ML         | scikit-learn                                                  | MISSING (import lỗi)                      | —                                                                                                           | uv pip / apt python3-sklearn | exec/network             |
| AI/ML         | opencv (cv2)                                                  | AVAILABLE (import thật 5.0.0)             | —                                                                                                           | uv pip / apt python3-opencv  | exec                     |
| AI/ML         | pytest                                                        | AVAILABLE (9.1.1, cả `python3 -m pytest`) | —                                                                                                           | pip --user                   | exec                     |
| AI/ML         | jupyter                                                       | AVAILABLE (binary trong ~/.local/bin)     | —                                                                                                           | uv pip / pip --user          | exec                     |
| AI/ML         | numpy, pandas, matplotlib, yaml                               | AVAILABLE (import thật)                   | —                                                                                                           | —                            | exec                     |
| Game          | godot, blender, RenderDoc, glTF tools                         | MISSING                                   | —                                                                                                           | apt/official                 | exec                     |
| Mobile        | javac                                                         | AVAILABLE                                 | 21.0.13                                                                                                     | apt                          | exec                     |
| Mobile        | mvn (Maven)                                                   | AVAILABLE                                 | —                                                                                                           | apt                          | exec                     |
| Mobile        | Android SDK, adb, emulator, Flutter CLI                       | MISSING                                   | —                                                                                                           | SDK manager                  | exec                     |
| Mobile        | Xcode tools                                                   | UNSUPPORTED                               | —                                                                                                           | chỉ macOS                    | license                  |
| Database      | sqlite3 CLI                                                   | MISSING                                   | —                                                                                                           | apt                          | read                     |
| Database      | node:sqlite                                                   | BUILTIN                                   | (Node 22, ExperimentalWarning)                                                                              | built-in                     | read                     |
| Database      | psql                                                          | MISSING                                   | —                                                                                                           | apt postgresql-client        | exec                     |
| Database      | mysql (client)                                                | AVAILABLE                                 | 11.8.6-MariaDB; service CHƯA verify                                                                         | apt                          | exec                     |
| Database      | mongosh                                                       | AVAILABLE                                 | 2.11.1; service CHƯA verify                                                                                 | apt/official                 | exec                     |
| Database      | redis-cli                                                     | AVAILABLE                                 | 8.0.5; service CHƯA verify                                                                                  | apt redis-tools              | exec                     |
| Data          | spark-submit, kafka, dbt, airflow                             | CHƯA KIỂM TRA                             | —                                                                                                           | pip/official                 | exec                     |
| Media         | ffmpeg                                                        | AVAILABLE                                 | (không in --version ngắn)                                                                                   | apt                          | exec                     |

## 3. Package manager hỗ trợ trong DependencyManager (theo thiết kế)

| Hệ điều hành          | Manager          | Trạng thái máy này    | Ghi chú install                                                              |
| --------------------- | ---------------- | --------------------- | ---------------------------------------------------------------------------- |
| Linux (Debian/Ubuntu) | apt              | AVAILABLE             | `apt-cache policy` để pin; `apt-get install -y <pkg>=<ver>`; log apt history |
| Linux (Fedora)        | dnf              | UNSUPPORTED ở máy này | adapter vẫn viết, detect trả missing                                         |
| Linux (Arch)          | pacman           | UNSUPPORTED ở máy này | adapter vẫn viết                                                             |
| Linux (openSUSE)      | zypper           | UNSUPPORTED ở máy này | adapter vẫn viết                                                             |
| Linux (Flatpak)       | flatpak          | AVAILABLE             | cần remote đã cấu hình                                                       |
| Cross-platform        | npm / pnpm / bun | AVAILABLE             | lockfile để reproducible                                                     |
| Cross-platform        | pip / uv         | AVAILABLE             | ưu tiên `uv` + requirements.lock                                             |
| Cross-platform        | cargo            | AVAILABLE             | `Cargo.lock`                                                                 |
| Cross-platform        | Conan / vcpkg    | MISSING               | adapter khi có nhu cầu C++                                                   |
| Embedded              | PlatformIO       | AVAILABLE             | `platformio.ini` pin platform/framework                                      |
| Embedded              | ESP-IDF          | MISSING               | yêu cầu IDF_PATH riêng                                                       |

## 4. Quy tắc metadata (Phase 14)

Mỗi tool adapter phải khai báo: `id`, `name`, `domain`, `description`, `executable`, `version`, `supportedPlatforms`, `dependencies`, `installationGuide`, `capabilities`, `availability`, `permissions`, `healthCheck`. `availability` được tính lúc runtime từ PATH, không hardcode. `healthCheck` là lệnh nhẹ (`<exe> --version`) với timeout; kết quả lưu trong bảng mới `tool_status`, không ghi đè cấu hình người dùng.

## 5. Rollback và log

- Mỗi install ghi `{domain, tool, manager, command, requestedBy, startedAt, finishedAt, exitCode, beforeVersion, afterVersion, rollbackCommand}`.
- Rollback: `apt-get remove`, `npm uninstall`, `uv pip uninstall`, `flatpak uninstall`, xoá file do installer tạo nếu có manifest. Không rolling back tool đang được tool khác dùng: kiểm tra dependency ngược trước khi xoá.
- Không tự động chạy `apt update` toàn hệ thống; chỉ chạy khi user approve và domain yêu cầu.
- Mọi lệnh install đi qua permission gate risk=network/exec, có approval UI; bị deny thì dừng, báo rõ lý do.

## 6. Trạng thái triển khai Dependency Manager (đã chạy)

- Bảng `dependency_events` được tạo bởi migration trong `store.ts`; ghi mọi yêu cầu cài/manual-required với domain, tool, command, exitCode, ok, detail JSON, timestamp.
- IPC `domain.dependency.install` nhận `approved: boolean`. Không approve → `requires-approval`, không chạy lệnh. Tool cần root (apt) → `requires-root` + `manualCommand`, có audit log nhưng không tự sudo.
- Verify sau install bằng `EnvironmentManager.snapshot([executable], force=true)`; chưa có rollback tự động cho mọi manager.
- Probe thực: `domain.dependency.plan` systems trả đúng tool có sẵn (sau khi sửa snapshot + regex `g++`); install chưa approve bị chặn.

## 7. Cập nhật ma trận này

Sau mỗi domain integration test, cập nhật cột trạng thái/phiên bản bằng output thật của lệnh đã chạy. Không đổi AVAILABLE thành Tested khi mới chỉ detect được executable.
