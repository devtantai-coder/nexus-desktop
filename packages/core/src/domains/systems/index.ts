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

const CMAKE = `cmake_minimum_required(VERSION 3.20)\nproject(nexus_systems LANGUAGES CXX)\nset(CMAKE_CXX_STANDARD 20)\nadd_executable(hello main.cpp)\nenable_testing()\nadd_test(NAME smoke COMMAND hello)\n`
const MAIN_CPP = `#include <iostream>\nint main() {\n  std::cout << "NEXUS systems smoke\\n";\n  return 0;\n}\n`

const aptTool = (
  id: string,
  name: string,
  executable: string,
  capabilities: string[],
): ToolMetadata =>
  defineTool(id, name, 'systems', executable, capabilities, {
    installationGuide: `apt-get install -y ${executable}`,
    installCommand: `apt-get install -y ${executable}`,
    requiresRoot: true,
  })

export class SystemsDomain extends BaseDomainAdapter {
  readonly id = 'systems'
  readonly label = 'Backend & Systems'
  readonly description = 'C/C++, Rust, Go, Java — compiler detection, build, test, debug'
  readonly platforms: Platform[] = ['linux', 'darwin']
  readonly tools: ToolMetadata[] = [
    aptTool('gcc', 'GCC', 'gcc', ['compiler', 'c']),
    aptTool('gpp', 'G++', 'g++', ['compiler', 'cpp']),
    aptTool('clang', 'Clang', 'clang', ['compiler', 'c', 'cpp']),
    aptTool('cmake', 'CMake', 'cmake', ['build-system']),
    aptTool('ninja', 'Ninja', 'ninja', ['build-system']),
    aptTool('make', 'Make', 'make', ['build-system']),
    aptTool('gdb', 'GDB', 'gdb', ['debug']),
    defineTool('cargo', 'Cargo', 'systems', 'cargo', ['build-system', 'rust'], {
      installationGuide: 'Install Rust via rustup',
      installCommand: 'rustup toolchain install stable',
    }),
    defineTool('go', 'Go', 'systems', 'go', ['runtime', 'build', 'go'], {
      installationGuide: 'Install Go from go.dev',
      requiresRoot: true,
    }),
  ]

  override detect(context: DomainContext): DomainMatch[] {
    const root = context.workspaceRoot
    if (root === null) return []
    const reasons: string[] = []
    for (const file of ['CMakeLists.txt', 'Makefile', 'Cargo.toml', 'go.mod', 'pom.xml']) {
      if (existsSync(join(root, file))) reasons.push(file)
    }
    if (reasons.length === 0) {
      try {
        const source = readdirSync(root).some((entry) => /\.(c|cc|cpp|rs|go|java)$/.test(entry))
        if (source) reasons.push('source files')
      } catch {
        return []
      }
    }
    if (reasons.length === 0) return []
    return [{ domainId: this.id, confidence: Math.min(1, 0.6 + reasons.length * 0.1), reasons }]
  }

  override createProject(_context: DomainContext, input: ProjectInput): ProjectResult {
    const root = input.root ?? ''
    if (root === '') return { ok: false, path: '', files: [], error: 'Missing project root' }
    const files: Array<[string, string]> = [
      ['CMakeLists.txt', CMAKE],
      ['main.cpp', MAIN_CPP],
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
      'cmake -S . -B build -G Ninja && cmake --build build',
      input.path,
      300_000,
    )
    return { ...result, artifacts: result.ok ? ['build/hello'] : [] }
  }

  override async test(_context: DomainContext, input: { path: string }): Promise<TestResult> {
    const result = await runCommand(
      'ctest --test-dir build --output-on-failure',
      input.path,
      180_000,
    )
    return { ...result, passed: 0, failed: 0 }
  }
}
