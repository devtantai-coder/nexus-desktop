# Mobile — REQUIRES INSTALL / iOS UNSUPPORTED

Adapter: `packages/core/src/domains/mobile/index.ts`

## Có thật (2026-11-19, Linux)

- Detect: `AndroidManifest.xml` (root hoặc `src/main/`), `pubspec.yaml`, `build.gradle[.kts]`, `settings.gradle[.kts]`.
- `project.create` → `src/main/AndroidManifest.xml` (exported launcher) + `MainActivity.java` (package `com.nexus.mobile`) + README.
- `build` → kiểm tra structure (Manifest + Activity tồn tại).
- `test` → `command -v adb`; thiếu → `ok: false` + reason `requires-install`. **Không fake.**
- javac 21.0.13 + mvn AVAILABLE (JVM) nhưng **Android SDK/adb chưa có** → không compile APK thật.
- **iOS trên Linux = UNSUPPORTED** (cần macOS + Xcode; không workaround).
- Flutter MISSING.

## Chưa có (sau khi cài Android SDK)

- `gradlew assembleDebug` trong scaffold có sẵn Gradle wrapper (chưa scaffold — cần SDK + xác nhận).
- `adb devices`/logcat streaming, emulator boot wait adapter.
- Flutter `flutter build apk` flow.

## Verify

```sh
pnpm run test   # domain.test.ts: mobile → create OK, manifest exists, test honest requires-install
```

Ràng buộc: không báo build/test pass khi SDK chưa cài; iOS luôn UNSUPPORTED trên Linux.
