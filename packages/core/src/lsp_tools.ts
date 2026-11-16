import { NexusError } from './errors.ts'
import type { LspService } from './lsp.ts'
import type { Json, ToolDefinition, ToolContext, ToolRegistry } from './tools.ts'

const requireWorkspace = (context: ToolContext) => {
  if (!context.workspace) throw new NexusError('E_TOOL', 'Workspace is unavailable')
  return context.workspace
}

const requirePath = (input: Json): string => {
  const value = input?.['path']
  if (typeof value !== 'string' || value.trim() === '') {
    throw new NexusError('E_VALIDATION', 'path is required')
  }
  return value.trim()
}

const positionFrom = (input: Json): { line: number; character: number } => {
  const line = typeof input?.['line'] === 'number' ? Math.trunc(input['line']) : 1
  const character = typeof input?.['character'] === 'number' ? Math.trunc(input['character']) : 1
  return { line: Math.max(0, line - 1), character: Math.max(0, character - 1) }
}

const positionParameter = {
  type: 'object',
  properties: {
    path: { type: 'string', description: 'Workspace-relative file path' },
    line: { type: 'integer', description: '1-based line number' },
    character: { type: 'integer', description: '1-based character/column number' },
  },
  required: ['path', 'line', 'character'],
  additionalProperties: false,
} as const

const toolDefinitions = (lsp: LspService): ToolDefinition[] => [
  {
    name: 'lsp_hover',
    description:
      'Show hover information (type signature and docs) at a position using the language server.',
    risk: 'read',
    parameters: positionParameter,
    execute: async (input, context) => {
      const workspace = requireWorkspace(context)
      const path = requirePath(input)
      const absolute = workspace.resolve(path)[0]
      return lsp.hover(workspace.rootPath, absolute, positionFrom(input))
    },
    summarize: (input) => `lsp hover ${String(input?.['path'] ?? '')}`,
  },
  {
    name: 'lsp_definition',
    description: 'Find the definition location at a position using the language server.',
    risk: 'read',
    parameters: positionParameter,
    execute: async (input, context) => {
      const workspace = requireWorkspace(context)
      const path = requirePath(input)
      const absolute = workspace.resolve(path)[0]
      return lsp.definition(workspace.rootPath, absolute, positionFrom(input))
    },
    summarize: (input) => `lsp definition ${String(input?.['path'] ?? '')}`,
  },
  {
    name: 'lsp_references',
    description: 'Find all references to the symbol at a position using the language server.',
    risk: 'read',
    parameters: positionParameter,
    execute: async (input, context) => {
      const workspace = requireWorkspace(context)
      const path = requirePath(input)
      const absolute = workspace.resolve(path)[0]
      return lsp.references(workspace.rootPath, absolute, positionFrom(input))
    },
    summarize: (input) => `lsp references ${String(input?.['path'] ?? '')}`,
  },
  {
    name: 'lsp_diagnostics',
    description:
      'Return compiler/language-server diagnostics for a file (errors, warnings, hints).',
    risk: 'read',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Workspace-relative file path' } },
      required: ['path'],
      additionalProperties: false,
    },
    execute: async (input, context) => {
      const workspace = requireWorkspace(context)
      const path = requirePath(input)
      const absolute = workspace.resolve(path)[0]
      const diagnostics = await lsp.diagnostics(workspace.rootPath, absolute)
      return { path, diagnostics }
    },
    summarize: (input) => `lsp diagnostics ${String(input?.['path'] ?? '')}`,
  },
]

export function registerLspTools(tools: ToolRegistry, lsp: LspService): void {
  for (const definition of toolDefinitions(lsp)) tools.register(definition)
}
