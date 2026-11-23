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

const PROJECT_GODOT = `; Engine configuration file.
config_version=5

[application]
config/name="NEXUS Game"
run/main_scene="res://scenes/main.tscn"
config/features=PackedStringArray("4.2")

[rendering]
renderer/rendering_method="forward_plus"
`
const MAIN_SCENE = `[gd_scene load_steps=2 format=3]

[ext_resource type="Script" path="res://scripts/main.gd" id="1"]

[node name="Main" type="Node2D"]
script = ExtResource("1")
`
const MAIN_GD = `extends Node2D

func _ready() -> void:
    print("NEXUS game ready")
`
const README = `# NEXUS Game (Godot 4)

Godot **chưa được cài** trên máy này — không tự tải. Cài godot (ví dụ \`apt-get install -y godot\` hoặc từ godotengine.org) sau khi bạn xác nhận, rồi:

\`\`\`sh
godot --headless --quit-after 1   # verify project load
godot --headless -s tests/run.gd  # unit test (tự viết)
\`\`\`

Unity/Unreal cần license thương mại — không khả dụng trong NEXUS.
`

export class GameDomain extends BaseDomainAdapter {
  readonly id = 'game'
  readonly label = 'Game Development'
  readonly description = 'Godot 4 project scaffold; build/test cần godot cài có xác nhận'
  readonly platforms: Platform[] = ['linux', 'darwin', 'win32']
  readonly tools: ToolMetadata[] = [
    defineTool('godot', 'Godot Engine', 'game', 'godot', ['engine', 'game', '2d-3d'], {
      description: 'Godot 4 — MIT license; headless mode cho CI',
      installationGuide: 'apt-get install -y godot, hoặc download từ godotengine.org',
      installCommand: 'apt-get install -y godot',
      requiresRoot: true,
    }),
    defineTool('blender', 'Blender', 'game', 'blender', ['3d', 'asset-pipeline'], {
      installationGuide: 'apt-get install -y blender',
      installCommand: 'apt-get install -y blender',
      requiresRoot: true,
    }),
    defineTool('gltf-validator', 'glTF Validator', 'game', 'gltf-validator', ['asset-validate'], {
      installationGuide: 'npm install -g gltf-validator',
      installCommand: 'npm install -g gltf-validator',
    }),
  ]

  override detect(context: DomainContext): DomainMatch[] {
    const root = context.workspaceRoot
    if (root === null) return []
    const reasons: string[] = []
    if (existsSync(join(root, 'project.godot'))) reasons.push('project.godot')
    try {
      if (readdirSync(root).some((entry) => entry.endsWith('.tscn') || entry.endsWith('.gd')))
        reasons.push('*.tscn/*.gd')
    } catch {
      // ignore unreadable root
    }
    if (existsSync(join(root, 'scenes')) || existsSync(join(root, 'scripts')))
      reasons.push('scenes/scripts')
    if (reasons.length === 0) return []
    return [{ domainId: this.id, confidence: Math.min(1, 0.6 + reasons.length * 0.2), reasons }]
  }

  override createProject(_context: DomainContext, input: ProjectInput): ProjectResult {
    const root = input.root ?? ''
    if (root === '') return { ok: false, path: '', files: [], error: 'Missing project root' }
    const files: Array<[string, string]> = [
      ['project.godot', PROJECT_GODOT],
      ['scenes/main.tscn', MAIN_SCENE],
      ['scripts/main.gd', MAIN_GD],
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
      'test -f project.godot && test -f scenes/main.tscn && test -f scripts/main.gd && echo "godot structure ok"',
      input.path,
      30_000,
    )
    return { ...result, artifacts: result.ok ? ['project.godot', 'scenes/main.tscn'] : [] }
  }

  override async test(_context: DomainContext, input: { path: string }): Promise<TestResult> {
    const result = await runCommand('command -v godot', input.path, 10_000)
    if (result.exitCode !== 0) {
      return {
        ok: false,
        command: 'command -v godot',
        exitCode: result.exitCode,
        output: '',
        durationMs: result.durationMs,
        timedOut: false,
        passed: 0,
        failed: 0,
        reason:
          'requires-install: godot chưa có trong PATH; cài có xác nhận trước (apt-get install -y godot). Không fake gameplay test.',
      }
    }
    return runCommand('godot --headless --quit-after 1', input.path, 120_000).then((run) => ({
      ...run,
      passed: 0,
      failed: 0,
    }))
  }
}
