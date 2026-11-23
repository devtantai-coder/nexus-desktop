# Desktop & OS — IMPLEMENTED + TESTED (scope Qt 6)

Adapter: `packages/core/src/domains/desktop/index.ts`

## Có thật (2026-11-19)

- cmake 4.2.3, qmake6 (Qt 6.10.2; `Qt6Core`/`Qt6Widgets` cmake config có sẵn), gdb 17.1, qemu-system-x86_64 AVAILABLE.
- Detect: `CMakeLists.txt`, `ui/`, `*.pro/*.ui`.
- `project.create` → `CMakeLists.txt` (Qt6 Widgets, C++20) + `main.cpp` (QApplication + `--smoke` mode) + README.
- `build` → `cmake -S . -B build && cmake --build build` (Qt6 Widgets **compile thật**, exit 0).
- `test` → `QT_QPA_PLATFORM=offscreen ctest` → 1/1 test pass (headless, không cần X). E2E `e2e-domain-desktop` exit 0.
- qemu-system-x86_64 có sẵn → nền tảng cho VM-mode OS dev (chưa wire adapter OS).

## Chưa có

- Packaging (.deb/.AppImage/.dmg) — electron-builder đã dùng ở app chính nhưng chưa adapter hóa cho project ngoài.
- QEMU VM runner cho kernel/driver (chỉ có x86_64; aarch64 thiếu).
- Electron CLI không nằm trong PATH (app chạy từ node_modules); không expose `electron` như tool.

## Verify

```sh
pnpm run test   # domain.test.ts: desktop → cmake+Qt6 build → offscreen ctest pass
```

Ràng buộc: test headless `QT_QPA_PLATFORM=offscreen`; không mở cửa sổ khi CI.
