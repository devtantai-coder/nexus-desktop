# Embedded & IoT — PARTIAL + REQUIRES TOOLCHAIN INSTALL

Adapter: `packages/core/src/domains/embedded/index.ts`

## Có thật (2026-11-19)

- arduino-cli AVAILABLE (chưa có board cắm; `arduino-cli board list` chỉ liệt kê — không compile được nếu chưa có core).
- PlatformIO Core 6.2.0 AVAILABLE; platforms đã cài: `espressif32@8.0.0`, `ststm32@20.0.0` — **nhưng `~/.platformio/packages` trống → toolchain chưa có**.
- Detect: `platformio.ini`, `src/main.cpp|c`, `*.ino`.
- `project.create` → `platformio.ini` (env esp32dev) + `src/main.cpp` (blink) + README — **scaffold thật**.
- `build`: nếu toolchain chưa có (hiện tại) → `ok: false` + reason `requires-toolchain-install` (≈100–200MB tải: `toolchain-xtensa-esp32`/`toolchain-gccarmnoneeabi`). **Không tự tải** — chờ user xác nhận. Khi có toolchain, `pio run` chạy thật.
- `test`: tương tự — không giả `pio test` khi không có board/native platform.

## Chưa có (cần cài + approve từng bước)

- esptool, idf.py (ESP-IDF), arm-none-eabi-gcc, openocd, qemu-system-arm: MISSING.
- Board detection tự động, pin mapping, GPIO/UART/SPI/I2C driver adapters.
- Firmware validation, serial monitor streaming qua artifact log.
- Simulator (QEMU/Renode) — chỉ khi cài và test trên board model cụ thể.

## Verify

```sh
pnpm run test   # domain.test.ts: embedded → create OK, build trả honest requires-toolchain-install
```

Ràng buộc: không bao giờ báo "compile xong" khi chưa chạy `pio run` thật; không giả lập board chưa test.
