import { existsSync, readdirSync } from 'node:fs'
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

const CMAKE = `cmake_minimum_required(VERSION 3.20)
project(nexus_qt_smoke LANGUAGES CXX)
find_package(Qt6 REQUIRED COMPONENTS Widgets)
set(CMAKE_CXX_STANDARD 20)
add_executable(nexus-qt main.cpp)
target_link_libraries(nexus-qt PRIVATE Qt6::Widgets)
enable_testing()
add_test(NAME smoke COMMAND nexus-qt --smoke)
set_tests_properties(smoke PROPERTIES ENVIRONMENT "QT_QPA_PLATFORM=offscreen")
`
const MAIN_CPP = `#include <QApplication>
#include <QLabel>
#include <cstdio>
#include <cstring>

int main(int argc, char** argv) {
  QApplication app(argc, argv);
  for (int i = 1; i < argc; ++i) {
    if (std::strcmp(argv[i], "--smoke") == 0) {
      std::printf("NEXUS Qt smoke ok\\n");
      return 0;
    }
  }
  QLabel label("NEXUS Desktop");
  label.show();
  return app.exec();
}
`
const README = `# NEXUS Desktop (Qt 6)

Ứng dụng desktop native thật: Qt 6 Widgets + CMake. Test chạy headless bằng QT_QPA_PLATFORM=offscreen.

\`\`\`sh
cmake -S . -B build && cmake --build build
QT_QPA_PLATFORM=offscreen ./build/nexus-qt --smoke
ctest --test-dir build --output-on-failure
\`\`\`

Kernel/driver chỉ hỗ trợ khi có QEMU (qemu-system-x86_64 có sẵn cho Linux VM); packaging qua electron-builder.
`

export class DesktopDomain extends BaseDomainAdapter {
  readonly id = 'desktop'
  readonly label = 'Desktop & OS'
  readonly description = 'Qt 6 / CMake / GDB native desktop — build + headless smoke test thật'
  readonly platforms: Platform[] = ['linux', 'darwin']
  readonly tools: ToolMetadata[] = [
    defineTool('cmake', 'CMake', 'desktop', 'cmake', ['build-system'], {
      installationGuide: 'apt-get install -y cmake',
      installCommand: 'apt-get install -y cmake',
      requiresRoot: true,
    }),
    defineTool('qmake6', 'QMake 6', 'desktop', 'qmake6', ['build-system', 'qt'], {
      description:
        'Qt 6 qmake (6.10.2 trên máy này); Widgets dev files tại /usr/lib/x86_64-linux-gnu/cmake/Qt6Widgets',
      installationGuide: 'apt-get install -y qt6-base-dev',
      installCommand: 'apt-get install -y qt6-base-dev',
      requiresRoot: true,
    }),
    defineTool('gdb', 'GDB', 'desktop', 'gdb', ['debug'], {
      installationGuide: 'apt-get install -y gdb',
      installCommand: 'apt-get install -y gdb',
      requiresRoot: true,
    }),
    defineTool(
      'qemu-system-x86_64',
      'QEMU (x86_64)',
      'desktop',
      'qemu-system-x86_64',
      ['virtualization', 'vm'],
      {
        installationGuide: 'apt-get install -y qemu-system-x86',
        installCommand: 'apt-get install -y qemu-system-x86',
        requiresRoot: true,
      },
    ),
    defineTool('electron', 'Electron CLI', 'desktop', 'electron', ['desktop', 'packaging'], {
      description: 'NEXUS app chạy Electron từ node_modules; binary không nằm trong PATH',
      installationGuide: 'pnpm add -D electron (project devDependency)',
    }),
  ]

  override detect(context: DomainContext): DomainMatch[] {
    const root = context.workspaceRoot
    if (root === null) return []
    const reasons: string[] = []
    if (existsSync(join(root, 'CMakeLists.txt'))) reasons.push('CMakeLists.txt')
    if (existsSync(join(root, 'ui'))) reasons.push('ui')
    try {
      const entries = readdirSync(root)
      if (entries.some((entry) => entry.endsWith('.pro') || entry.endsWith('.ui')))
        reasons.push('*.pro/*.ui')
    } catch {
      // ignore unreadable root
    }
    if (reasons.length === 0) return []
    return [{ domainId: this.id, confidence: Math.min(1, 0.5 + reasons.length * 0.2), reasons }]
  }

  override createProject(_context: DomainContext, input: ProjectInput): ProjectResult {
    const root = input.root ?? ''
    if (root === '') return { ok: false, path: '', files: [], error: 'Missing project root' }
    const files: Array<[string, string]> = [
      ['CMakeLists.txt', CMAKE],
      ['main.cpp', MAIN_CPP],
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
      'cmake -S . -B build && cmake --build build',
      input.path,
      600_000,
    )
    return { ...result, artifacts: result.ok ? ['build/nexus-qt'] : [] }
  }

  override async test(_context: DomainContext, input: { path: string }): Promise<TestResult> {
    const result = await runCommand(
      'QT_QPA_PLATFORM=offscreen ctest --test-dir build --output-on-failure',
      input.path,
      300_000,
    )
    return { ...result, passed: 0, failed: 0 }
  }
}
