import { NexusError } from './errors.ts'
import type { RetrievalService } from './retrieval.ts'
import type { ToolDefinition, ToolContext, ToolRegistry } from './tools.ts'

const requireWorkspace = (context: ToolContext) => {
  if (!context.workspace) throw new NexusError('E_TOOL', 'Workspace is unavailable')
  return context.workspace
}

const toolDefinitions = (retrieval: RetrievalService): ToolDefinition[] => [
  {
    name: 'retrieval_index',
    description:
      'Index workspace source files into the semantic retrieval store. Requires an embedding provider/model in settings.',
    risk: 'read',
    parameters: {
      type: 'object',
      properties: {
        force: { type: 'boolean', description: 'Re-embed files even if unchanged' },
      },
      additionalProperties: false,
    },
    execute: async (input, context) => {
      const workspace = requireWorkspace(context)
      const force = input?.['force'] === true
      return retrieval.index(context.projectId, workspace, { force })
    },
    summarize: () => 'index workspace for semantic search',
  },
  {
    name: 'retrieval_search',
    description:
      'Semantic code search over the indexed workspace. Returns the most similar chunks with file paths and line ranges.',
    risk: 'read',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Natural-language or code query' },
        limit: { type: 'integer', description: 'Maximum results (1-20)' },
      },
      required: ['query'],
      additionalProperties: false,
    },
    execute: async (input, context) => {
      const query = input?.['query']
      if (typeof query !== 'string' || query.trim() === '') {
        throw new NexusError('E_VALIDATION', 'query is required')
      }
      const limit = typeof input?.['limit'] === 'number' ? Math.trunc(input['limit']) : 8
      return { results: await retrieval.search(context.projectId, query.trim(), limit) }
    },
    summarize: (input) => `semantic search ${String(input?.['query'] ?? '')}`,
  },
  {
    name: 'retrieval_stats',
    description: 'Return the number of indexed code chunks for the current project.',
    risk: 'read',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    execute: async (_input, context) => retrieval.stats(context.projectId),
    summarize: () => 'retrieval stats',
  },
]

export function registerRetrievalTools(tools: ToolRegistry, retrieval: RetrievalService): void {
  for (const definition of toolDefinitions(retrieval)) tools.register(definition)
}
