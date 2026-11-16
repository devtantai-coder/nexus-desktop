import { z } from 'zod'
import type { IpcChannel } from './ipc'

const id = z.string().min(1).max(200)
const pathStr = z.string().min(1).max(4096)
const relPath = z.string().min(1).max(4096)

const attachment = z.object({
  name: z.string().max(300),
  path: pathStr.optional(),
  content: z.string().max(2_000_000).optional(),
  mimeType: z.string().max(200).optional(),
  base64: z.string().max(8_000_000).optional(),
  kind: z.enum(['file', 'image']),
})

const empty = z.undefined().or(z.null()).or(z.void())

export const ipcSchemas: Record<IpcChannel, z.ZodTypeAny> = {
  'app.info': empty,
  'app.openExternal': z.object({ url: z.string().url().max(2048) }),
  'app.showItemInFolder': z.object({ path: pathStr }),
  'app.openLogs': empty,
  'app.logs': z.object({ limit: z.number().int().min(1).max(2000).optional() }).optional(),
  'app.setNativeTheme': z.object({ theme: z.enum(['light', 'dark', 'system']) }),
  'app.notify': z.object({
    title: z.string().max(200),
    body: z.string().max(2000).optional(),
    level: z.string().max(20).optional(),
  }),
  'app.setPreventSleep': z.object({ enabled: z.boolean() }),

  'window.popout': z.object({ sessionId: z.string().max(200) }),
  'window.minimize': empty,
  'window.toggleMaximize': empty,
  'window.close': empty,
  'window.state': empty,

  'settings.all': empty,
  'settings.set': z.object({ key: z.string().min(1).max(200), value: z.unknown() }),
  'settings.reset': z.object({ key: z.string().min(1).max(200).optional() }).optional(),

  'provider.list': empty,
  'provider.save': z.object({
    id: id.optional(),
    kind: z.enum([
      'openai',
      'openai-compatible',
      'vercel',
      'anthropic',
      'google',
      'deepseek',
      'ollama',
      'openrouter',
      'groq',
      'mistral',
      'xai',
      'together',
      'fireworks',
      'perplexity',
      'cohere',
      'qwen',
      'moonshot',
      'zai',
      'minimax',
      'cerebras',
      'deepinfra',
      'github-models',
      'lmstudio',
      'llamacpp',
      'vllm',
      'azure-openai',
    ]),
    name: z.string().min(1).max(120),
    baseUrl: z.string().max(2048).optional(),
    apiKey: z.string().max(4096).nullable().optional(),
    enabled: z.boolean().optional(),
  }),
  'provider.delete': z.object({ id }),
  'provider.test': z.object({ id }),
  'provider.discover': z.object({ id }),
  'provider.setKey': z.object({ id, apiKey: z.string().max(4096).nullable() }),

  'model.list': z.object({ providerId: id.optional() }).optional(),
  'model.save': z.object({
    id: id.optional(),
    providerId: id,
    modelId: z.string().min(1).max(300),
    displayName: z.string().max(200).optional(),
    contextWindow: z.number().int().min(512).max(10_000_000).optional(),
    maxOutputTokens: z.number().int().min(1).max(1_000_000).optional(),
    temperature: z.number().min(0).max(2).optional(),
    categories: z
      .array(z.enum(['general', 'coding', 'reasoning', 'vision', 'tools', 'long-context']))
      .optional(),
    supportsTools: z.boolean().optional(),
    supportsVision: z.boolean().optional(),
    supportsReasoning: z.boolean().optional(),
    reasoningEffort: z.enum(['off', 'minimal', 'low', 'medium', 'high']).optional(),
    variant: z.string().max(80).optional(),
  }),
  'model.delete': z.object({ id }),
  'model.setDefault': z.object({ id }),

  'project.pick': empty,
  'project.open': z.object({ path: pathStr }),
  'project.list': empty,
  'project.remove': z.object({ id }),
  'project.update': z.object({
    id,
    name: z.string().min(1).max(200).optional(),
    description: z.string().max(5000).optional(),
  }),

  'workspace.tree': z.object({
    projectId: id,
    path: relPath.optional(),
    depth: z.number().int().min(1).max(12).optional(),
  }),
  'workspace.readFile': z.object({ projectId: id, path: relPath }),
  'workspace.writeFile': z.object({
    projectId: id,
    path: relPath,
    content: z.string().max(20_000_000),
  }),
  'workspace.createFile': z.object({
    projectId: id,
    path: relPath,
    content: z.string().max(4_000_000).optional(),
  }),
  'workspace.createDir': z.object({ projectId: id, path: relPath }),
  'workspace.rename': z.object({ projectId: id, from: relPath, to: relPath }),
  'workspace.delete': z.object({ projectId: id, path: relPath }),
  'workspace.searchFiles': z.object({
    projectId: id,
    query: z.string().min(1).max(500),
    limit: z.number().int().min(1).max(500).optional(),
  }),
  'workspace.searchCode': z.object({
    projectId: id,
    query: z.string().min(1).max(500),
    regex: z.boolean().optional(),
    limit: z.number().int().min(1).max(500).optional(),
  }),
  'workspace.pickFiles': z.object({ kind: z.enum(['file', 'image']) }),

  'session.list': z
    .object({
      projectId: id.optional(),
      archived: z.boolean().optional(),
      query: z.string().max(300).optional(),
    })
    .optional(),
  'session.create': z
    .object({
      projectId: id.nullable().optional(),
      title: z.string().max(300).optional(),
      mode: z.enum(['ask', 'plan', 'code', 'agent', 'review', 'debug']).optional(),
      providerId: id.nullable().optional(),
      modelId: z.string().max(300).nullable().optional(),
      modelVariant: z.string().max(80).nullable().optional(),
      permissionMode: z
        .enum(['read-only', 'workspace-write', 'terminal-approval', 'elevated', 'unrestricted'])
        .optional(),
      engine: z.enum(['auto', 'native', 'claude-agent-sdk', 'langgraph']).optional(),
    })
    .optional(),
  'session.get': z.object({ id }),
  'session.update': z.object({
    id,
    patch: z.object({
      title: z.string().min(1).max(300).optional(),
      mode: z.enum(['ask', 'plan', 'code', 'agent', 'review', 'debug']).optional(),
      providerId: id.nullable().optional(),
      modelId: z.string().max(300).nullable().optional(),
      modelVariant: z.string().max(80).nullable().optional(),
      permissionMode: z
        .enum(['read-only', 'workspace-write', 'terminal-approval', 'elevated', 'unrestricted'])
        .optional(),
      engine: z.enum(['auto', 'native', 'claude-agent-sdk', 'langgraph']).optional(),
      archived: z.boolean().optional(),
      pinned: z.boolean().optional(),
    }),
  }),
  'session.delete': z.object({ id }),
  'session.duplicate': z.object({ id }),
  'session.messages': z.object({ sessionId: id }),
  'session.rewind': z.object({ sessionId: id, messageId: id }),
  'session.export': z.object({ sessionId: id }),

  'agent.start': z.object({
    sessionId: id,
    prompt: z.string().min(1).max(200_000),
    mode: z.enum(['ask', 'plan', 'code', 'agent', 'review', 'debug']).optional(),
    permissionMode: z
      .enum(['read-only', 'workspace-write', 'terminal-approval', 'elevated', 'unrestricted'])
      .optional(),
    providerId: id.optional(),
    modelId: z.string().max(300).optional(),
    projectId: id.optional(),
    engine: z.enum(['auto', 'native', 'claude-agent-sdk', 'langgraph']).optional(),
    attachments: z.array(attachment).max(20).optional(),
  }),
  'agent.cancel': z.object({ taskId: id }),
  'agent.approve': z.object({
    approvalId: id,
    approved: z.boolean(),
    alwaysAllow: z.boolean().optional(),
  }),
  'agent.resume': z.object({ taskId: id }),
  'agent.steer': z.object({ taskId: id, prompt: z.string().min(1).max(200_000) }),
  'agent.contextUsage': z.object({ taskId: id }),
  'agent.stopAfterTurn': z.object({ taskId: id }),
  'agent.rewind': z.object({ taskId: id }),
  'agent.active': empty,
  'agent.toolList': empty,
  'agent.sandboxPolicy': z.object({ permissionMode: z.string().min(1).max(40) }),

  'task.list': z
    .object({
      sessionId: id.optional(),
      projectId: id.optional(),
      limit: z.number().int().min(1).max(500).optional(),
    })
    .optional(),
  'task.get': z.object({ id }),

  'chat.cancel': z.object({ sessionId: id }),

  'git.status': z.object({ projectId: id }),
  'git.diff': z.object({
    projectId: id,
    path: relPath.optional(),
    staged: z.boolean().optional(),
  }),
  'git.log': z.object({ projectId: id, limit: z.number().int().min(1).max(200).optional() }),
  'git.branches': z.object({ projectId: id }),
  'git.stage': z.object({ projectId: id, paths: z.array(relPath).min(1).max(500) }),
  'git.unstage': z.object({ projectId: id, paths: z.array(relPath).min(1).max(500) }),
  'git.commit': z.object({
    projectId: id,
    message: z.string().min(1).max(5000),
    paths: z.array(relPath).max(500).optional(),
  }),
  'git.checkout': z.object({
    projectId: id,
    branch: z.string().min(1).max(300),
    create: z.boolean().optional(),
  }),
  'git.fetch': z.object({ projectId: id }),
  'git.pull': z.object({ projectId: id }),
  'git.push': z.object({ projectId: id }),
  'git.discard': z.object({ projectId: id, paths: z.array(relPath).min(1).max(500) }),

  'terminal.create': z
    .object({
      projectId: id.optional(),
      cwd: pathStr.optional(),
      cols: z.number().int().min(2).max(500).optional(),
      rows: z.number().int().min(2).max(300).optional(),
      shell: z.string().max(500).optional(),
    })
    .optional(),
  'terminal.write': z.object({ id, data: z.string().max(100_000) }),
  'terminal.resize': z.object({
    id,
    cols: z.number().int().min(2).max(500),
    rows: z.number().int().min(2).max(300),
  }),
  'terminal.dispose': z.object({ id }),
  'terminal.list': empty,

  'change.list': z
    .object({
      taskId: id.optional(),
      sessionId: id.optional(),
      status: z.string().max(50).optional(),
    })
    .optional(),
  'change.diff': z.object({ id }),
  'change.accept': z.object({ id }),
  'change.reject': z.object({ id }),
  'change.revert': z.object({ id }),

  'orchestrator.config': empty,
  'orchestrator.setConfig': z.object({
    config: z.array(
      z.object({
        role: z.enum(['planner', 'researcher', 'coder', 'debugger', 'reviewer', 'tester']),
        enabled: z.boolean(),
        model: z.string().max(300).optional(),
        description: z.string().max(500).optional(),
      }),
    ),
  }),
  'orchestrator.run': z.object({
    sessionId: id,
    prompt: z.string().min(1).max(200_000),
    roles: z.array(z.string().max(50)).max(6).optional(),
  }),

  'usage.summary': z.object({ days: z.number().int().min(1).max(365).optional() }).optional(),
  'usage.list': z.object({ limit: z.number().int().min(1).max(1000).optional() }).optional(),
  'stats.session': z.object({ sessionId: z.string().min(1) }),

  'db.stats': empty,
  'db.backup': empty,
  'db.vacuum': empty,

  'commands.list': z.object({ projectId: z.string().min(1).max(200).optional() }).optional(),

  'mcp.servers': empty,
  'mcp.tools': z.object({ serverId: z.string().min(1).max(120).optional() }).optional(),
  'mcp.restart': empty,
  'mcp.auth.start': z.object({ serverId: z.string().min(1) }),
  'mcp.auth.logout': z.object({ serverId: z.string().min(1) }),

  'search.global': z.object({ query: z.string().min(1).max(300) }),
}
