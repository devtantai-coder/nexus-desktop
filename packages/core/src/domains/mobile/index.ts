import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { writeFileAtomic } from '../../util.ts'
import { runCommand } from '../../domain/runner.ts'
import type {
  BuildResult,
  DomainContext,
  DomainMatch,
  Platform,
  ProjectInput,
  ProjectResult,
  TestResult,
  ToolMetadata,
} from '../../domain/types.ts'
import { BaseDomainAdapter, defineTool } from '../base.ts'

const MANIFEST = `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
  <application android:label="NEXUS Mobile">
    <activity android:name=".MainActivity" android:exported="true">
      <intent-filter>
        <action android:name="android.intent.action.MAIN" />
        <category android:name="android.intent.category.LAUNCHER" />
      </intent-filter>
    </activity>
  </application>
</manifest>
`
const MAIN_ACTIVITY = `package com.nexus.mobile

import android.app.Activity
import android.os.Bundle

public class MainActivity extends Activity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState)
        // Android SDK + Gradle cần cài có xác nhận trước khi build thật.
    }
}
`
const README = `# NEXUS Mobile (Android)

Android SDK **chưa có** trên máy này — không tự cài. Cần \`adb\`, \`sdkmanager\`, build-tools và xác nhận của bạn.

\`\`\`sh
adb devices        # liệt kê thiết bị/emulator
gradle assembleDebug   # sau khi có Android SDK
\`\`\`

iOS native build trên Linux: UNSUPPORTED (cần macOS + Xcode).
`

export class MobileDomain extends BaseDomainAdapter {
  readonly id = 'mobile'
  readonly label = 'Mobile'
  readonly description =
    'Android scaffold; SDK/tooling cần cài có xác nhận; iOS trên Linux = UNSUPPORTED'
  readonly platforms: Platform[] = ['linux', 'darwin', 'win32']
  readonly tools: ToolMetadata[] = [
    defineTool('adb', 'Android Debug Bridge', 'mobile', 'adb', ['android', 'device', 'debug'], {
      installationGuide: 'apt-get install -y adb (hoặc Android SDK platform-tools)',
      installCommand: 'apt-get install -y adb',
      requiresRoot: true,
    }),
    defineTool('flutter', 'Flutter', 'mobile', 'flutter', ['cross-platform', 'dart'], {
      installationGuide: 'Install Flutter SDK từ flutter.dev (tarball hoặc snap)',
      permissions: ['exec', 'network'],
    }),
    defineTool('javac', 'OpenJDK javac', 'mobile', 'javac', ['jvm', 'build'], {
      description: 'JDK compiler — cần Android SDK + Gradle cho APK thật',
      installationGuide: 'apt-get install -y openjdk-21-jdk-headless',
      installCommand: 'apt-get install -y openjdk-21-jdk-headless',
      requiresRoot: true,
    }),
    defineTool('mvn', 'Maven', 'mobile', 'mvn', ['build-system', 'jvm'], {
      installationGuide: 'apt-get install -y maven',
      installCommand: 'apt-get install -y maven',
      requiresRoot: true,
    }),
  ]

  override detect(context: DomainContext): DomainMatch[] {
    const root = context.workspaceRoot
    if (root === null) return []
    const reasons: string[] = []
    for (const file of [
      'AndroidManifest.xml',
      'pubspec.yaml',
      'build.gradle',
      'build.gradle.kts',
      'settings.gradle',
      'settings.gradle.kts',
    ]) {
      if (existsSync(join(root, file))) reasons.push(file)
    }
    if (existsSync(join(root, 'src', 'main', 'AndroidManifest.xml')))
      reasons.push('src/main/AndroidManifest.xml')
    if (reasons.length === 0) return []
    return [{ domainId: this.id, confidence: Math.min(1, 0.6 + reasons.length * 0.2), reasons }]
  }

  override createProject(_context: DomainContext, input: ProjectInput): ProjectResult {
    const root = input.root ?? ''
    if (root === '') return { ok: false, path: '', files: [], error: 'Missing project root' }
    const files: Array<[string, string]> = [
      ['src/main/AndroidManifest.xml', MANIFEST],
      ['src/main/java/com/nexus/mobile/MainActivity.java', MAIN_ACTIVITY],
      ['README.md', README],
    ]
    for (const [relative, content] of files) {
      if (!writeFileAtomic(join(root, relative), content)) {
        return { ok: false, path: root, files: [], error: `Cannot write ${relative}` }
      }
    }
    return { ok: true, path: root, files: files.map(([relative]) => relative) }
  }

  override async build(_context: DomainContext, input: { path: string }): Promise<BuildResult> {
    const result = await runCommand(
      'test -f src/main/AndroidManifest.xml && test -f src/main/java/com/nexus/mobile/MainActivity.java && echo "android structure ok"',
      input.path,
      30_000,
    )
    return { ...result, artifacts: result.ok ? ['src/main/AndroidManifest.xml'] : [] }
  }

  override async test(_context: DomainContext, input: { path: string }): Promise<TestResult> {
    const result = await runCommand('command -v adb', input.path, 10_000)
    if (result.exitCode !== 0) {
      return {
        ok: false,
        command: 'command -v adb',
        exitCode: result.exitCode,
        output: '',
        durationMs: result.durationMs,
        timedOut: false,
        passed: 0,
        failed: 0,
        reason:
          'requires-install: Android SDK/adb chưa có; cài có xác nhận trước. iOS trên Linux = UNSUPPORTED (cần macOS + Xcode).',
      }
    }
    const devices = await runCommand('adb devices', input.path, 30_000)
    return {
      ok: devices.exitCode === 0,
      command: devices.command,
      exitCode: devices.exitCode,
      output: devices.output,
      durationMs: devices.durationMs,
      timedOut: devices.timedOut,
      passed: 0,
      failed: 0,
    }
  }
}
