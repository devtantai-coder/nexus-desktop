import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import { writeFileAtomic, homeDir } from '../../util.ts'
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

const PLATFORMIO_INI = `[env:esp32dev]
platform = espressif32
board = esp32dev
framework = arduino
`
const MAIN_CPP = `#include <Arduino.h>

void setup() {
  pinMode(LED_BUILTIN, OUTPUT);
}

void loop() {
  digitalWrite(LED_BUILTIN, HIGH);
  delay(500);
  digitalWrite(LED_BUILTIN, LOW);
  delay(500);
}
`
const README = `# NEXUS Embedded project

PlatformIO (espressif32) + Arduino framework. Board detection cần board thật qua USB/serial.

\`\`\`sh
arduino-cli board list   # liệt kê board đang cắm
pio run                  # build (cần toolchain espressif32)
pio test                 # cần unit test + board/native platform
\`\`\`

Toolchain hiện CHƯA cài. Không tự tải — chờ bạn xác nhận (≈200MB) rồi mới \`pio pkg install\`.
Simulator (QEMU/Renode) chỉ hỗ trợ được khi cài; không giả lập board chưa test.
`

const toolchainInstalled = (): boolean => {
  try {
    return readdirSync(join(homeDir(), '.platformio', 'packages')).length > 0
  } catch {
    return false
  }
}

export class EmbeddedDomain extends BaseDomainAdapter {
  readonly id = 'embedded'
  readonly label = 'Embedded & IoT'
  readonly description =
    'Arduino/PlatformIO, ESP32/STM32 — board thật; simulator chỉ khi cài và test'
  readonly platforms: Platform[] = ['linux', 'darwin', 'win32']
  readonly tools: ToolMetadata[] = [
    defineTool(
      'arduino-cli',
      'arduino-cli',
      'embedded',
      'arduino-cli',
      ['cli', 'arduino', 'board'],
      {
        installationGuide: 'Install from arduino.cc or package manager',
        permissions: ['exec'],
      },
    ),
    defineTool(
      'pio',
      'PlatformIO Core',
      'embedded',
      'pio',
      ['build-system', 'embedded', 'platformio'],
      {
        description:
          'PlatformIO Core — platform espressif32/ststm32 đã cài platform, toolchain CHƯA cài',
        installationGuide: 'uv pip install platformio',
      },
    ),
    defineTool('esptool', 'esptool', 'embedded', 'esptool', ['flash', 'esp32'], {
      installationGuide:
        'python3 -m pip install --user esptool (đi kèm ESP-IDF/PlatformIO toolchain)',
      installCommand: 'python3 -m pip install --user esptool',
    }),
    defineTool(
      'arm-none-eabi-gcc',
      'GCC ARM Embedded',
      'embedded',
      'arm-none-eabi-gcc',
      ['compiler', 'arm'],
      {
        installationGuide: 'apt-get install -y gcc-arm-none-eabi',
        installCommand: 'apt-get install -y gcc-arm-none-eabi',
        requiresRoot: true,
      },
    ),
    defineTool('openocd', 'OpenOCD', 'embedded', 'openocd', ['debug', 'jtag'], {
      installationGuide: 'apt-get install -y openocd',
      installCommand: 'apt-get install -y openocd',
      requiresRoot: true,
    }),
    defineTool(
      'qemu-system-arm',
      'QEMU (ARM)',
      'embedded',
      'qemu-system-arm',
      ['simulator', 'arm'],
      {
        installationGuide: 'apt-get install -y qemu-system-arm',
        installCommand: 'apt-get install -y qemu-system-arm',
        requiresRoot: true,
      },
    ),
  ]

  override detect(context: DomainContext): DomainMatch[] {
    const root = context.workspaceRoot
    if (root === null) return []
    const reasons: string[] = []
    if (existsSync(join(root, 'platformio.ini'))) reasons.push('platformio.ini')
    for (const file of ['src/main.cpp', 'src/main.c']) {
      if (existsSync(join(root, file)) && existsSync(join(root, 'platformio.ini')))
        reasons.push(file)
    }
    try {
      if (readdirSync(root).some((entry) => entry.endsWith('.ino'))) reasons.push('*.ino')
    } catch {
      // ignore unreadable root
    }
    if (reasons.length === 0) return []
    return [{ domainId: this.id, confidence: Math.min(1, 0.6 + reasons.length * 0.15), reasons }]
  }

  override createProject(_context: DomainContext, input: ProjectInput): ProjectResult {
    const root = input.root ?? ''
    if (root === '') return { ok: false, path: '', files: [], error: 'Missing project root' }
    const files: Array<[string, string]> = [
      ['platformio.ini', PLATFORMIO_INI],
      ['src/main.cpp', MAIN_CPP],
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
    if (!toolchainInstalled()) {
      return {
        ok: false,
        command: 'pio run',
        exitCode: -1,
        output: '',
        durationMs: 0,
        timedOut: false,
        artifacts: [],
        reason:
          'requires-toolchain-install: PlatformIO chưa có toolchain cho espressif32 (toolchain-xtensa-esp32, ≈100–200MB). Cần xác nhận trước khi tải; không tự cài.',
      }
    }
    const result = await runCommand('pio run', input.path, 600_000)
    return { ...result, artifacts: result.ok ? ['.pio/build'] : [] }
  }

  override async test(_context: DomainContext, input: { path: string }): Promise<TestResult> {
    if (!toolchainInstalled()) {
      return {
        ok: false,
        command: 'pio test',
        exitCode: -1,
        output: '',
        durationMs: 0,
        timedOut: false,
        passed: 0,
        failed: 0,
        reason:
          'requires-toolchain-install: pio test cần toolchain/native platform chưa cài; cần xác nhận trước khi tải. Không giả lập board chưa test.',
      }
    }
    const result = await runCommand('pio test', input.path, 600_000)
    return { ...result, passed: 0, failed: 0 }
  }
}
