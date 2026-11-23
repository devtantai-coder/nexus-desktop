# Game Development — REQUIRES INSTALL

Adapter: `packages/core/src/domains/game/index.ts`

## Có thật (2026-11-19)

- Detect: `project.godot`, `*.tscn`/`*.gd`, `scenes/`, `scripts/`.
- `project.create` → Godot 4 project thật (`project.godot` config_version=5, `scenes/main.tscn`, `scripts/main.gd`) + README.
- `build` → kiểm tra structure (file tồn tại) — Godot binary chưa có nên build không compile engine.
- `test` → `command -v godot`; thiếu → `ok: false` + reason `requires-install`. **Không fake gameplay test.**
- godot, blender, gltf-validator: MISSING (cài cần xác nhận: `apt-get install -y godot` hoặc godotengine.org).
- Unity/Unreal: cần **license thương mại** — không hỗ trợ.

## Chưa có (sau khi cài godot)

- `godot --headless --quit-after 1` smoke, `--headless -s tests/run.gd` runner.
- Scene/asset pipeline, frame-time capture, profiler adapter.
- Blender headless render/bake adapter.

## Verify

```sh
pnpm run test   # domain.test.ts: game → create OK, structure check OK, test honest requires-install
```

Ràng buộc: không claim build/test pass khi engine chưa cài; scaffold không chạy code Godot.
