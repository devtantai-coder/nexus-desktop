# Backend & Systems — IMPLEMENTED + TESTED (scope C/C++)

Adapter: `packages/core/src/domains/systems/index.ts`

## Có thật

- Tools detect qua PATH (2026-11-19): gcc/g++ 15.2.0, clang, cmake 4.2.3, ninja 1.13.2, make 4.4.1, gdb 17.1, cargo 1.99.1, go.
- Detect: `CMakeLists.txt`, `Makefile`, `Cargo.toml`, `go.mod`, `pom.xml` hoặc file nguồn `.c/.cc/.cpp/.rs/.go/.java` ở root.
- `project.create` → `CMakeLists.txt` + `main.cpp` (CMake 3.20, C++20).
- `build` → `cmake -S . -B build -G Ninja && cmake --build build` exit 0.
- `test` → `ctest --test-dir build --output-on-failure` exit 0, 1 test pass.
- E2E: `e2e-domain-sys`.

## Chưa có

- Rust/Go/Java scaffold + build thật (hiện chỉ C/C++).
- Cross-compile, ABI/binary analysis (nm/objdump adapter).
- Debug adapter thật cho GDB/LLDB (DebugManager mới trả unsupported/honest reason).

## Verify

```sh
pnpm run test   # domain.test.ts: systems project → cmake build → ctest
```

Ràng buộc: artifacts ghi `build/hello`; không cài sysroot cross-compile.
