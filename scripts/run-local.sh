#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ ! -x .runtime/electron/electron ]]; then
  echo "runtime chưa có. Chạy: pnpm install && pnpm native:build && pnpm build" >&2
  exit 1
fi

if [[ ! -x native/build/nexus-core ]]; then
  cmake -S native -B native/build -DCMAKE_BUILD_TYPE=Release
  cmake --build native/build --parallel
fi

exec env \
  DISPLAY="${DISPLAY:-:0}" \
  WAYLAND_DISPLAY="${WAYLAND_DISPLAY:-wayland-0}" \
  NEXUS_CORE_BIN="$ROOT/native/build/nexus-core" \
  ELECTRON_DISABLE_SECURITY_WARNINGS=1 \
  .runtime/electron/electron .runtime/app \
  --no-sandbox --disable-gpu --disable-dev-shm-usage --ozone-platform=x11
