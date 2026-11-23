import { StringDecoder } from 'node:string_decoder'

import { NexusError } from './errors.ts'
import type { EventBus } from './events.ts'
import { httpRequest } from './http.ts'
import type { HttpResponse } from './http.ts'
import { redactSecrets } from './security.ts'
import { SecretStore } from './secrets.ts'
import type { Store } from './store.ts'

export type Json = any
import {
  endsWith,
  jsonBool,
  jsonDouble,
  jsonInt,
  jsonStr,
  nowMs,
  optString,
  startsWith,
  toLower,
  trim,
  urlEncode,
  uuid,
} from './util.ts'

export interface ChatMessage {
  role: string
  content: string
  name?: string
  tool_call_id?: string
  tool_calls?: Json[]
  images?: Json[]
}

export interface ChatUsage {
  input_tokens: number
  output_tokens: number
  cached_tokens: number
  /** OpenAI/Gemini đã gồm cached trong input_tokens; Anthropic tách riêng. */
  cached_in_input?: boolean
}

export interface ChatResult {
  text: string
  reasoning: string
  finish_reason: string
  tool_calls: Json[]
  usage: ChatUsage
}

export type DeltaCallback = (text: string, reasoning: string) => void

const FNV_OFFSET = 1469598103934665603n
const FNV_PRIME = 1099511628211n
const MASK64 = 0xffffffffffffffffn

const providerNeedsKey = (kind: string): boolean =>
  !new Set(['ollama', 'lmstudio', 'llamacpp', 'vllm', 'openai-compatible']).has(kind)

const supportsStreamUsage = (kind: string): boolean =>
  new Set([
    'openai',
    'openai-compatible',
    'azure-openai',
    'deepseek',
    'openrouter',
    'groq',
    'mistral',
    'xai',
    'together',
    'fireworks',
    'cerebras',
    'deepinfra',
    'github-models',
    'lmstudio',
    'llamacpp',
    'vllm',
    'qwen',
    'moonshot',
    'zai',
    'minimax',
  ]).has(kind)

function chatEndpoint(base: string, kind: string): string {
  let url = base
  if (!endsWith(url, '/chat/completions')) url += '/chat/completions'
  if (kind === 'azure-openai' && !url.includes('api-version=')) {
    url += url.includes('?') ? '&' : '?'
    url += 'api-version=2024-10-21'
  }
  return url
}

const modelsEndpoint = (base: string): string =>
  endsWith(base, '/models') ? base : `${base}/models`

function addAuthHeaders(headers: Record<string, string>, kind: string, key: string): void {
  if (key === '') return
  if (kind === 'azure-openai') {
    headers['api-key'] = key
    return
  }
  headers['Authorization'] = `Bearer ${key}`
  if (kind === 'openrouter') {
    headers['HTTP-Referer'] = 'https://nexus.local'
    headers['X-Title'] = 'NEXUS Desktop'
  }
}

const stripTrailingSlashes = (value: string): string => value.replace(/\/+$/, '')

const baseUrlFor = (provider: Json): string => {
  let base = jsonStr(provider, 'baseUrl')
  if (base === '') base = Providers.defaultBaseUrl(jsonStr(provider, 'kind'))
  return stripTrailingSlashes(base)
}

const promptCacheEnabled = (store: Store, base: string): boolean => {
  const setting = store.settingGet('agent.promptCache', null)
  if (typeof setting === 'boolean') return setting
  return base.includes('anthropic.com')
}

const ID_REASONING_NEEDLES = [
  'o1',
  'o3',
  'o4',
  'r1',
  'reason',
  'thinking',
  'qwq',
  'gpt-5',
  'gpt-6',
  'glm-4.5',
  'glm-4.6',
  'glm-4.7',
  'glm-5',
  'deepseek-flash',
  'deepseek-v4',
  'deepseek-reasoner',
  'deepseek-v3',
  'claude-3-7',
  'claude-4',
  'fable-5',
  'opus-5',
  'sonnet-5',
  'haiku-5',
  'mythos-5',
  'grok-4',
  'kimi-k2',
  'kimi-k3',
  'sonar',
  'minimax-m3',
  'qwen3.',
  'qwen3-',
  'qwen3:',
  'qwen4',
  'gemini-3',
  'gemini-4',
]

const idMatchesReasoning = (id: string): boolean =>
  ID_REASONING_NEEDLES.some((needle) => id.includes(needle))

const authQueryKey = (url: string, key: string): string => {
  if (key === '') return url
  return `${url}${url.includes('?') ? '&' : '?'}key=${urlEncode(key)}`
}

const raiseHttp = (status: number, body: string, name: string): never => {
  const detail = redactSecrets(body).slice(0, 800)
  if (status === 401 || status === 403) {
    throw new NexusError(
      'E_AUTH',
      `${name}: authentication failed (${status}). Check the API key. ${detail}`,
    )
  }
  if (status === 429) {
    throw new NexusError('E_RATE_LIMIT', `${name}: rate limited (429). Retry later.`)
  }
  if (
    status === 400 &&
    (detail.includes('context') ||
      detail.includes('too long') ||
      detail.includes('too many') ||
      detail.includes('prompt is too long') ||
      detail.includes('tokens exceed') ||
      detail.includes('maximum context'))
  ) {
    throw new NexusError('E_CONTEXT_OVERFLOW', `${name}: context window exceeded.`)
  }
  if (status >= 500) {
    throw new NexusError('E_PROVIDER', `${name}: upstream error (${status}).`)
  }
  throw new NexusError('E_PROVIDER', `${name}: request failed (${status}): ${detail}`)
}

const ensureSuccess = (response: HttpResponse, name: string): void => {
  if (response.error === 'cancelled') throw new NexusError('E_CANCELLED', 'Cancelled')
  if (response.error !== '') throw new NexusError('E_NETWORK', `${name}: ${response.error}`)
  if (response.status < 200 || response.status >= 300) {
    raiseHttp(response.status, response.body, name)
  }
}

const providerName = (provider: Json): string =>
  jsonStr(provider, 'name', jsonStr(provider, 'kind', 'provider'))

const parseToolArguments = (raw: string): Json => {
  if (raw === '') return {}
  try {
    const parsed = JSON.parse(raw)
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed
      : { value: parsed }
  } catch {
    return { _raw: raw }
  }
}

const modelWireId = (model: Json): string => {
  let id = jsonStr(model, 'modelId')
  if (startsWith(id, 'models/')) id = id.slice(7)
  return id
}

// Static seed catalogs (Nov 2026) — chỉ dùng khi provider mới được thêm; app vẫn tự refresh live /models.
const CATALOGS: Record<string, string[]> = {
  openai: [
    'gpt-6.2-astra',
    'gpt-6.2-sol',
    'gpt-6.1-terra',
    'gpt-6-luna',
    'gpt-6-astra',
    'gpt-6.1-sol',
    'gpt-6-sol',
    'gpt-5.6-sol',
    'gpt-5.6-terra',
    'gpt-5.6-luna',
    'gpt-5.5',
    'gpt-5.5-pro',
    'gpt-5.4',
    'gpt-5.4-pro',
    'gpt-5.4-mini',
    'gpt-5.2',
    'gpt-5.2-pro',
    'gpt-5.2-codex',
    'gpt-5-mini',
    'gpt-5-nano',
    'gpt-4.1',
    'gpt-4.1-mini',
    'gpt-4o',
    'o3',
    'o4-mini',
  ],
  anthropic: [
    'claude-fable-5-2',
    'claude-mythos-5-2',
    'claude-opus-5-5',
    'claude-sonnet-5-5',
    'claude-haiku-5-5',
    'claude-fable-5-1',
    'claude-mythos-5-1',
    'claude-fable-5',
    'claude-opus-5',
    'claude-opus-4-8',
    'claude-opus-4-7',
    'claude-opus-4-6',
    'claude-sonnet-5',
    'claude-sonnet-4-6',
    'claude-opus-4-5-20251101',
    'claude-haiku-4-5-20251001',
  ],
  google: [
    'gemini-4-neon',
    'gemini-4-hydrogen',
    'gemini-4-carbon',
    'gemini-4-argon',
    'gemini-3.8-flash',
    'gemini-3.6-flash',
    'gemini-3.5-flash-lite',
    'gemini-3.1-flash-lite',
    'gemini-3.1-pro-preview',
    'gemini-3-flash-preview',
    'gemini-2.5-flash-lite',
    'gemini-live-2.5-flash-native-audio-preview-12-2025',
    'gemini-2.0-flash-exp',
    'gemma-3-27b-it',
    'gemma-3-12b-it',
    'gemma-3-4b-it',
  ],
  groq: [
    'llama-3.3-70b-versatile',
    'llama-3.1-8b-instant',
    'openai/gpt-oss-120b',
    'openai/gpt-oss-20b',
    'deepseek-r1-distill-llama-70b',
    'meta-llama/llama-4-scout-17b-16e-instruct',
    'qwen/qwen3-32b',
    'mixtral-8x7b-32768',
    'gemma2-9b-it',
  ],
  openrouter: [
    'openrouter/auto',
    'openai/gpt-5.2',
    'openai/gpt-5',
    'anthropic/claude-sonnet-4-6',
    'anthropic/claude-opus-4-6',
    'google/gemini-3.6-flash',
    'x-ai/grok-4.5',
    'deepseek/deepseek-v4-pro',
    'meta-llama/llama-4-scout',
    'z-ai/glm-4.7',
  ],
  mistral: [
    'mistral-large-latest',
    'mistral-medium-latest',
    'mistral-small-latest',
    'magistral-medium-latest',
    'magistral-small-latest',
    'codestral-latest',
    'devstral-medium-latest',
    'devstral-small-latest',
    'ministral-3b-latest',
    'pixtral-large-latest',
    'open-mistral-nemo',
  ],
  deepseek: ['deepseek-flash', 'deepseek-v4-pro', 'deepseek-v3.2'],
  xai: ['grok-4.7', 'grok-4.6', 'grok-4.5', 'grok-4.3', 'grok-build-0.1'],
  together: [
    'meta-llama/Llama-3.3-70B-Instruct-Turbo',
    'meta-llama/Llama-4-Scout-17B-16E-Instruct',
    'deepseek-ai/DeepSeek-V4-Pro',
    'Qwen/Qwen4-Max',
    'zai-org/glm-5',
    'moonshotai/kimi-k3',
    'mistralai/Mistral-Large-2411',
  ],
  fireworks: [
    'accounts/fireworks/models/deepseek-v4-pro',
    'accounts/fireworks/models/qwen4-max',
    'accounts/fireworks/models/kimi-k3',
    'accounts/fireworks/models/glm-5',
    'accounts/fireworks/models/llama-v3p3-70b-instruct',
    'accounts/fireworks/models/gpt-oss-120b',
  ],
  perplexity: ['sonar', 'sonar-pro', 'sonar-reasoning-pro', 'sonar-deep-research'],
  cohere: [
    'command-a-03-2025',
    'command-a-reasoning-08-2025',
    'command-r-plus-08-2024',
    'command-r-08-2024',
  ],
  qwen: [
    'qwen4-max',
    'qwen3.8-max',
    'qwen3.8-flash',
    'qwen3.7-plus',
    'qwen3.7-max',
    'qwen3.7-flash',
    'qwen3.6-plus',
    'qwen3.6-flash',
    'qwen3.5-plus',
    'qwen3.5-flash',
    'qwen3-coder-flash',
    'qwen-plus',
    'qwen3-coder-plus',
    'qwen-max',
    'qwen-flash',
  ],
  moonshot: [
    'kimi-k3.1-pro',
    'kimi-k3.1-pro-highspeed',
    'kimi-k3',
    'kimi-k2.7-code',
    'kimi-k2.7-code-highspeed',
    'kimi-k2.6',
  ],
  zai: [
    'glm-5.3',
    'glm-5.2',
    'glm-5.1',
    'glm-5',
    'glm-5-turbo',
    'glm-4.7',
    'glm-4.7-flash',
    'glm-4.7-flashx',
    'glm-4.6',
  ],
  minimax: ['MiniMax-M3.1-Flash', 'MiniMax-M3'],
  cerebras: [
    'llama-3.3-70b',
    'llama-3.1-8b',
    'qwen-3-235b-a22b-instruct-2507',
    'gpt-oss-120b',
    'zai-glm-4.7',
  ],
  deepinfra: [
    'deepseek-ai/DeepSeek-V4-Pro',
    'meta-llama/Meta-Llama-3.3-70B-Instruct',
    'zai-org/GLM-5',
    'Qwen/Qwen4-Max',
    'moonshotai/Kimi-K3',
    'gpt-oss-120b',
  ],
  'github-models': [
    'openai/gpt-5',
    'openai/gpt-4.1',
    'openai/gpt-4o',
    'anthropic/claude-sonnet-4-6',
    'meta/llama-3.3-70b-instruct',
  ],
  ollama: [
    'llama3.1:8b',
    'llama3.3:70b',
    'qwen3:32b',
    'qwen4-max',
    'deepseek-r1:70b',
    'gpt-oss:120b',
    'mistral:7b',
    'gemma3:27b',
    'codellama:34b',
  ],
  lmstudio: ['llama-3.3-70b-instruct', 'qwen4-max', 'deepseek-r1-distill-llama-70b'],
  llamacpp: ['llama-3.3-70b-instruct', 'qwen4-max', 'gpt-oss-120b'],
  vllm: ['meta-llama/Llama-3.3-70B-Instruct', 'Qwen/Qwen4-Max', 'gpt-oss-120b'],
  'azure-openai': [
    'gpt-6.2-sol',
    'gpt-6-sol',
    'gpt-5.2',
    'gpt-5.4-mini',
    'gpt-4.1',
    'gpt-4o',
    'o3',
  ],
}

function catalogModels(kind: string, base: string): string[] {
  const tag = toLower(`${kind} ${base}`)
  const key = toLower(kind)
  if (key in CATALOGS) return CATALOGS[key] as string[]
  if (tag.includes('dashscope')) return CATALOGS['qwen'] as string[]
  if (tag.includes('zhipu') || tag.includes('bigmodel') || tag.includes('z.ai')) {
    return CATALOGS['zai'] as string[]
  }
  if (tag.includes('moonshot')) return CATALOGS['moonshot'] as string[]
  if (tag.includes('deepseek')) return CATALOGS['deepseek'] as string[]
  if (tag.includes('openrouter')) {
    return [
      'openai/gpt-5.2',
      'openai/gpt-5',
      'anthropic/claude-sonnet-4-6',
      'anthropic/claude-opus-4-6',
      'google/gemini-3.6-flash',
      'x-ai/grok-4.5',
      'deepseek/deepseek-v4-pro',
      'moonshotai/kimi-k3',
      'qwen/qwen4-max',
      'qwen/qwen3-32b',
      'z-ai/glm-4.7',
      'meta-llama/llama-3.3-70b-instruct',
      'minimax/minimax-m3-1-flash',
    ]
  }
  return [
    'gpt-5.2',
    'gpt-5',
    'gpt-4.1',
    'gpt-4o',
    'o3',
    'o4-mini',
    'claude-sonnet-5-5',
    'gemini-3.8-flash',
    'deepseek-flash',
    'deepseek-v4-pro',
    'qwen-plus',
    'qwen-flash',
    'glm-4.7',
    'kimi-k3',
    'llama-3.3-70b-versatile',
    'mistral-large-latest',
  ]
}

const MANDATORY_NEEDLES = [
  'o1',
  'deepseek-reasoner',
  'deepseek-r1',
  'qwq',
  'kimi-k2-thinking',
  'sonar-reasoning',
]
// OpenAI GPT-5 / o-series reject `max_tokens` (require `max_completion_tokens`)
// and only accept the default temperature.
const COMPLETION_TOKEN_NEEDLES = ['gpt-5', 'gpt-6', 'o1', 'o3', 'o4', 'gpt-oss']
const requiresCompletionTokens = (id: string): boolean =>
  COMPLETION_TOKEN_NEEDLES.some((needle) => id.includes(needle))
const isMandatoryReasoning = (id: string): boolean =>
  MANDATORY_NEEDLES.some((needle) => id.includes(needle))

function makeModelEntry(
  id: string,
  display: string,
  supportsReasoning: boolean,
  efforts: string[],
  mandatory: boolean,
  context: number,
  maxOutput: number,
): Json {
  const entry: Record<string, Json> = {
    id,
    supportsReasoning,
    supportedReasoningEfforts: efforts,
    reasoningMandatory: mandatory,
  }
  if (display !== '') entry['displayName'] = display
  if (context > 0) entry['contextWindow'] = context
  if (maxOutput > 0) entry['maxOutputTokens'] = maxOutput
  return entry
}

function jsonLooseInt(value: Json, keys: string[]): number {
  if (!value || typeof value !== 'object') return 0
  for (const key of keys) {
    const item = value[key]
    if (typeof item === 'number' && Number.isFinite(item)) return Math.trunc(item)
    if (typeof item === 'string' && /^\d+$/.test(item.trim())) return Math.trunc(Number(item))
  }
  return 0
}

function catalogEntries(kind: string, base: string): Json[] {
  const result: Json[] = []
  for (const id of catalogModels(kind, base)) {
    const lowered = toLower(id)
    const supported = idMatchesReasoning(lowered)
    const mandatory = supported && isMandatoryReasoning(lowered)
    const gpt5Family =
      lowered.includes('gpt-5') ||
      lowered.includes('gpt-6') ||
      lowered.includes('gpt-oss') ||
      lowered.includes('o3') ||
      lowered.includes('o4')
    result.push(
      makeModelEntry(
        id,
        '',
        supported,
        supported
          ? gpt5Family
            ? ['minimal', 'low', 'medium', 'high']
            : ['low', 'medium', 'high']
          : [],
        mandatory,
        0,
        0,
      ),
    )
  }
  return result
}

export class Providers {
  private readonly store: Store
  private readonly secrets: SecretStore
  private readonly events: EventBus

  constructor(store: Store, secrets: SecretStore, events: EventBus) {
    this.store = store
    this.secrets = secrets
    this.events = events
  }

  static defaultBaseUrl(kind: string): string {
    const bases: Record<string, string> = {
      openai: 'https://api.openai.com/v1',
      anthropic: 'https://api.anthropic.com/v1',
      google: 'https://generativelanguage.googleapis.com/v1beta',
      deepseek: 'https://api.deepseek.com/v1',
      ollama: 'http://localhost:11434',
      openrouter: 'https://openrouter.ai/api/v1',
      groq: 'https://api.groq.com/openai/v1',
      mistral: 'https://api.mistral.ai/v1',
      xai: 'https://api.x.ai/v1',
      together: 'https://api.together.xyz/v1',
      fireworks: 'https://api.fireworks.ai/inference/v1',
      perplexity: 'https://api.perplexity.ai',
      cohere: 'https://api.cohere.ai/compatibility/v1',
      qwen: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
      moonshot: 'https://api.moonshot.ai/v1',
      zai: 'https://api.z.ai/api/paas/v4',
      minimax: 'https://api.minimax.io/v1',
      cerebras: 'https://api.cerebras.ai/v1',
      deepinfra: 'https://api.deepinfra.com/v1/openai',
      'github-models': 'https://models.inference.ai.azure.com',
      lmstudio: 'http://127.0.0.1:1234/v1',
      llamacpp: 'http://127.0.0.1:8080/v1',
      vllm: 'http://127.0.0.1:8000/v1',
      'azure-openai': 'https://YOUR-RESOURCE.openai.azure.com/openai/deployments/YOUR-DEPLOYMENT',
    }
    return bases[kind] ?? 'http://localhost:8000/v1'
  }

  static defaultsForModel(modelId: string): [number, number] {
    const id = toLower(modelId)
    const has = (needles: string[]): boolean => needles.some((needle) => id.includes(needle))
    // o1 có trong bảng reasoning/needs-completion nhưng thiếu ở bảng ngữ cảnh.
    if (/(^|[^a-z0-9])o1([^a-z0-9]|$)/.test(id)) return [200000, 100000]
    if (
      has([
        'claude',
        'gemini-3',
        'gemini-4',
        'gpt-4.1',
        'gpt-5',
        'gpt-6',
        'o3',
        'o4',
        'deepseek-v4',
        'deepseek-flash',
        'qwen4',
        'qwen3.8',
        'kimi-k3',
      ])
    ) {
      return [1000000, 128000]
    }
    if (has(['grok-4', 'deepseek-v3.2'])) {
      return [500000, 128000]
    }
    if (has(['qwen3.', 'qwen-plus', 'glm-5', 'glm-4.7'])) {
      return [200000, 128000]
    }
    if (has(['gpt-4o', 'gemini-2', 'grok-3', 'kimi-k2', 'moonshot', 'glm', 'command-r']))
      return [128000, 16384]
    if (has(['qwen', 'llama-3.3', 'llama3'])) return [128000, 8192]
    if (has(['deepseek-reasoner', 'r1'])) return [64000, 8192]
    if (has(['deepseek'])) return [64000, 8192]
    if (has(['mistral', 'mixtral'])) return [32768, 8192]
    if (has(['sonar'])) return [127000, 8192]
    if (has(['phi', 'gemma', 'llama2'])) return [8192, 4096]
    return [32768, 8192]
  }

  static inferCategories(modelId: string): Json[] {
    const id = toLower(modelId)
    const categories = new Set<string>(['general'])
    const has = (needles: string[]): boolean => needles.some((needle) => id.includes(needle))
    if (
      has([
        'coder',
        'codestral',
        'codex',
        'devstral',
        'qwen2.5-coder',
        'deepseek-coder',
        'gpt-6',
        'gpt-5',
        'grok-4',
      ]) ||
      (id.includes('kimi') && id.includes('code'))
    ) {
      categories.add('coding')
    }
    if (
      has([
        'o1',
        'o3',
        'o4',
        'reason',
        'r1',
        'thinking',
        'deepseek-v3',
        'deepseek-flash',
        'deepseek-v4',
        'qwq',
        'grok',
        'glm-4',
        'glm-5',
        'kimi',
        'sonar',
        'gpt-6',
        'qwen3.',
        'qwen4',
        'gemini-3',
        'gemini-4',
        'claude',
      ])
    ) {
      categories.add('reasoning')
    }
    if (
      has([
        'vision',
        'vl',
        'gpt-4o',
        'gpt-5',
        'gpt-6',
        'claude',
        'gemini',
        'grok-4',
        'kimi',
        'llava',
        'pixtral',
      ])
    ) {
      categories.add('vision')
    }
    if (
      has([
        'gpt-4',
        'gpt-5',
        'gpt-6',
        'claude',
        'gemini',
        'qwen',
        'llama-3.',
        'llama-4',
        'mistral-large',
        'deepseek',
        'grok',
        'kimi',
        'glm',
        'command-r',
      ])
    ) {
      categories.add('tools')
    }
    if (has(['128k', '200k', '1m', 'long'])) categories.add('long-context')
    return [...categories]
  }

  static inferSupportsReasoning(modelId: string): boolean {
    return idMatchesReasoning(toLower(modelId))
  }

  list(): Json {
    return this.store.providerList()
  }

  save(input: Json): Json {
    let cipher: string | undefined
    let hint: string | undefined
    if (typeof input?.['apiKey'] === 'string') {
      const key = trim(input['apiKey'])
      if (key !== '') {
        cipher = this.secrets.encrypt(key)
        hint = SecretStore.mask(key)
      }
    }
    return this.store.providerSave(input, cipher, hint)
  }

  remove(id: string): void {
    this.store.providerRemove(id)
  }

  setKey(id: string, apiKey: Json): Json {
    this.store.providerRaw(id)
    if (
      apiKey === null ||
      apiKey === undefined ||
      (typeof apiKey === 'string' && trim(apiKey) === '')
    ) {
      return this.store.providerSetKey(id, null, null)
    }
    if (typeof apiKey !== 'string') throw new NexusError('E_VALIDATION', 'API key must be a string')
    const key = trim(apiKey)
    return this.store.providerSetKey(id, this.secrets.encrypt(key), SecretStore.mask(key))
  }

  apiKey(id: string): string {
    const raw = this.store.providerRaw(id)
    const cipher = optString(raw, 'apiKeyCipher')
    if (cipher === '') return ''
    try {
      return this.secrets.decrypt(cipher)
    } catch (error) {
      throw new NexusError(
        'E_AUTH',
        `Cannot decrypt API key for ${jsonStr(raw, 'name')}: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  private adapter(id: string): Json {
    const raw = this.store.providerRaw(id)
    if (!jsonBool(raw, 'enabled', true)) {
      throw new NexusError('E_CONFIG', `Provider ${jsonStr(raw, 'name')} is disabled`)
    }
    return raw
  }

  private promptCacheKey(messages: ChatMessage[]): string {
    let anchor = ''
    for (const message of messages) {
      if (message.role === 'tool') continue
      anchor += message.content.slice(0, 512)
      if (anchor.length >= 1024) break
    }
    let hash = FNV_OFFSET
    const buffer = Buffer.from(anchor, 'utf8')
    for (const byte of buffer) {
      hash ^= BigInt(byte)
      hash = (hash * FNV_PRIME) & MASK64
    }
    return hash.toString(16).padStart(16, '0')
  }

  private async runDiscovery(provider: Json): Promise<[Json[], string]> {
    const kind = jsonStr(provider, 'kind')
    const base = baseUrlFor(provider)
    const cipher = optString(provider, 'apiKeyCipher')
    const key = cipher === '' ? '' : this.apiKey(jsonStr(provider, 'id'))
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    let url = ''
    if (kind === 'anthropic') {
      headers['x-api-key'] = key
      headers['anthropic-version'] = '2023-06-01'
      url = `${base}/models?limit=100`
    } else if (kind === 'google') {
      url = authQueryKey(`${base}/models?pageSize=200`, key)
    } else if (kind === 'ollama') {
      url = `${base}/api/tags`
    } else {
      addAuthHeaders(headers, kind, key)
      url = modelsEndpoint(base)
      if (kind === 'azure-openai' && !url.includes('api-version=')) {
        url += url.includes('?') ? '&' : '?'
        url += 'api-version=2025-01-01-preview'
      }
    }
    let entries: Json[] = []
    let detail = ''
    try {
      if (kind === 'azure-openai') {
        throw new NexusError(
          'E_PROVIDER',
          'Discovery endpoint is not available for this provider kind',
        )
      }
      if (kind === 'perplexity') {
        throw new NexusError(
          'E_PROVIDER',
          'Discovery endpoint is not available for this provider kind',
        )
      }
      const response = await httpRequest({ url, method: 'GET', headers, timeoutSeconds: 30 })
      ensureSuccess(response, jsonStr(provider, 'name', 'provider'))
      let body: Json = null
      try {
        body = JSON.parse(response.body)
      } catch {
        throw new NexusError('E_PROVIDER', 'Invalid model list response')
      }
      if (kind === 'ollama') {
        for (const entry of body?.['models'] ?? []) {
          const id = jsonStr(entry, 'name', jsonStr(entry, 'model'))
          if (id === '') continue
          const lowered = toLower(id)
          let supported = idMatchesReasoning(lowered)
          try {
            const showResponse = await httpRequest({
              url: `${base}/api/show`,
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ model: id, name: id }),
              timeoutSeconds: 4,
            })
            if (
              showResponse.error === '' &&
              showResponse.status >= 200 &&
              showResponse.status < 300
            ) {
              let showBody: Json = null
              try {
                showBody = JSON.parse(showResponse.body)
              } catch {
                showBody = null
              }
              const capabilities = showBody?.['capabilities']
              if (Array.isArray(capabilities)) {
                supported = capabilities.some(
                  (capability) =>
                    typeof capability === 'string' && toLower(capability) === 'thinking',
                )
              }
            }
          } catch {
            // nuốt lỗi /api/show — giống C++
          }
          entries.push(
            makeModelEntry(
              id,
              '',
              supported,
              supported ? ['low', 'medium', 'high'] : [],
              supported && isMandatoryReasoning(lowered),
              0,
              0,
            ),
          )
        }
      } else if (kind === 'google') {
        for (const entry of body?.['models'] ?? []) {
          let id = jsonStr(entry, 'name')
          if (startsWith(id, 'models/')) id = id.slice(7)
          if (id === '') continue
          const display = jsonStr(entry, 'displayName')
          const context = jsonLooseInt(entry, ['inputTokenLimit'])
          const maxOutput = jsonLooseInt(entry, ['outputTokenLimit'])
          const lowered = toLower(id)
          let supported = idMatchesReasoning(lowered)
          if (typeof entry?.['thinking'] === 'boolean') supported = entry['thinking']
          entries.push(
            makeModelEntry(
              id,
              display,
              supported,
              supported ? ['low', 'medium', 'high'] : [],
              supported && isMandatoryReasoning(lowered),
              context,
              maxOutput,
            ),
          )
        }
      } else if (kind === 'anthropic') {
        for (const entry of body?.['data'] ?? []) {
          const id = jsonStr(entry, 'id')
          if (id === '') continue
          const display = jsonStr(entry, 'display_name', jsonStr(entry, 'displayName'))
          const [context, maxOutput] = Providers.defaultsForModel(id)
          const lowered = toLower(id)
          const supported = idMatchesReasoning(lowered)
          entries.push(
            makeModelEntry(
              id,
              display,
              supported,
              supported ? ['low', 'medium', 'high'] : [],
              supported && isMandatoryReasoning(lowered),
              context,
              maxOutput,
            ),
          )
        }
      } else {
        for (const entry of body?.['data'] ?? []) {
          const id = jsonStr(entry, 'id', jsonStr(entry, 'model', jsonStr(entry, 'name')))
          if (id === '') continue
          const display = jsonStr(
            entry,
            'name',
            jsonStr(entry, 'display_name', jsonStr(entry, 'title', jsonStr(entry, 'displayName'))),
          )
          const lowered = toLower(id)
          const supported = idMatchesReasoning(lowered)
          const gpt5Family =
            lowered.includes('gpt-5') ||
            lowered.includes('gpt-6') ||
            lowered.includes('gpt-oss') ||
            lowered.includes('o3') ||
            lowered.includes('o4')
          const efforts = supported
            ? gpt5Family
              ? ['minimal', 'low', 'medium', 'high']
              : ['low', 'medium', 'high']
            : []
          const context = jsonLooseInt(entry, [
            'context_length',
            'context_window',
            'max_model_len',
            'max_context_length',
            'inputTokenLimit',
            'max_tokens_limit',
            'max_context_tokens',
          ])
          const maxOutput = jsonLooseInt(entry, [
            'max_output_tokens',
            'max_completion_tokens',
            'max_tokens',
            'outputTokenLimit',
            'max_output_tokens_limit',
          ])
          entries.push(
            makeModelEntry(
              id,
              display,
              supported,
              efforts,
              supported && isMandatoryReasoning(lowered),
              context,
              maxOutput,
            ),
          )
        }
      }
      detail = `${entries.length} models (API)`
    } catch (error) {
      let message = error instanceof Error ? error.message : String(error)
      if (key !== '') {
        while (message.includes(key)) message = message.split(key).join('<redacted>')
      }
      if (message.length > 200) message = `${message.slice(0, 200)}…`
      entries = catalogEntries(kind, base)
      detail =
        entries.length === 0
          ? `API list failed (${message}); add models manually`
          : `API list failed (${message}); returned built-in catalog (subset may differ per account)`
    }
    if (entries.length === 0) entries = catalogEntries(kind, base)
    const seen = new Set<string>()
    const deduped: Json[] = []
    for (const entry of entries) {
      const id = jsonStr(entry, 'id')
      const lowered = toLower(id)
      if (seen.has(lowered)) continue
      seen.add(lowered)
      deduped.push(entry)
      if (deduped.length >= 400) break
    }
    return [deduped, detail]
  }

  async discover(id: string): Promise<Json> {
    return this.discoverProvider(this.adapter(id))
  }

  private async discoverProvider(provider: Json): Promise<Json> {
    const [entries, detail] = await this.runDiscovery(provider)
    this.events.emit('provider.status', {
      providerId: jsonStr(provider, 'id'),
      status: 'ok',
      detail,
    })
    return entries
  }

  async test(id: string): Promise<Json> {
    const start = nowMs()
    let provider: Json
    try {
      provider = this.adapter(id)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.events.emit('provider.status', { providerId: id, status: 'error', detail: message })
      return { ok: false, error: { code: 'E_CONFIG', message } }
    }
    const [entries, detail] = await this.runDiscovery(provider)
    if (entries.length === 0) {
      this.events.emit('provider.status', { providerId: id, status: 'error', detail })
      return {
        ok: false,
        latencyMs: nowMs() - start,
        error: { code: 'E_PROVIDER', message: detail },
      }
    }
    const list = entries.slice(0, 200).map((entry) => jsonStr(entry, 'id'))
    this.events.emit('provider.status', { providerId: id, status: 'ok', detail })
    return { ok: true, latencyMs: nowMs() - start, models: list, detail }
  }

  async chat(
    provider: Json,
    model: Json,
    messages: ChatMessage[],
    tools: Json,
    textMode: boolean,
    onDelta?: DeltaCallback,
    abort?: AbortSignal,
  ): Promise<ChatResult> {
    const kind = jsonStr(provider, 'kind')
    if (kind === 'anthropic')
      return this.chatAnthropic(provider, model, messages, tools, textMode, onDelta, abort)
    if (kind === 'google')
      return this.chatGemini(provider, model, messages, tools, textMode, onDelta, abort)
    if (kind === 'ollama')
      return this.chatOllama(provider, model, messages, tools, textMode, onDelta, abort)
    return this.chatOpenAI(provider, model, messages, tools, textMode, onDelta, abort)
  }

  /* ------------------------------------------------------------------ openai */
  private async chatOpenAI(
    provider: Json,
    model: Json,
    messages: ChatMessage[],
    tools: Json,
    textMode: boolean,
    onDelta: DeltaCallback | undefined,
    abort: AbortSignal | undefined,
  ): Promise<ChatResult> {
    const name = providerName(provider)
    const kind = jsonStr(provider, 'kind')
    const key = this.apiKey(jsonStr(provider, 'id'))
    if (key === '' && providerNeedsKey(kind)) {
      throw new NexusError('E_AUTH', `${name}: API key is missing`)
    }
    const wireModel = modelWireId(model)
    const loweredWire = toLower(wireModel)
    const restrictedOpenAI = requiresCompletionTokens(loweredWire)
    const payload: Record<string, Json> = {
      model: wireModel,
      stream: true,
    }
    if (!restrictedOpenAI) payload['temperature'] = jsonDouble(model, 'temperature', 0.2)
    const maxTokens = jsonInt(model, 'maxOutputTokens', 8192)
    if (maxTokens > 0) {
      payload[restrictedOpenAI ? 'max_completion_tokens' : 'max_tokens'] = maxTokens
    }
    const jsonMessages: Json[] = []
    for (const message of messages) {
      if (
        message.role === 'assistant' &&
        Array.isArray(message.tool_calls) &&
        message.tool_calls.length > 0
      ) {
        const calls = message.tool_calls.map((call) => ({
          id: jsonStr(call, 'id'),
          type: 'function',
          function: {
            name: jsonStr(call, 'name'),
            arguments: 'arguments' in call ? JSON.stringify(call['arguments'] ?? {}) : '{}',
          },
        }))
        jsonMessages.push({ role: 'assistant', content: message.content, tool_calls: calls })
        continue
      }
      if (message.role === 'tool') {
        const entry: Record<string, Json> = {
          role: 'tool',
          tool_call_id: message.tool_call_id ?? '',
          content: message.content,
        }
        if (message.name) entry['name'] = message.name
        jsonMessages.push(entry)
        continue
      }
      if (message.role === 'user' && Array.isArray(message.images) && message.images.length > 0) {
        const parts: Json[] = []
        if (message.content !== '') parts.push({ type: 'text', text: message.content })
        for (const image of message.images) {
          const mime = typeof image?.['mimeType'] === 'string' ? image['mimeType'] : 'image/png'
          const data = typeof image?.['base64'] === 'string' ? image['base64'] : ''
          if (data === '') continue
          parts.push({ type: 'image_url', image_url: { url: `data:${mime};base64,${data}` } })
        }
        jsonMessages.push({ role: 'user', content: parts })
        continue
      }
      jsonMessages.push({ role: message.role, content: message.content })
    }
    payload['messages'] = jsonMessages
    if (!textMode && Array.isArray(tools) && tools.length > 0) {
      payload['tools'] = tools.map((tool) => ({
        type: 'function',
        function: {
          name: jsonStr(tool, 'name'),
          description: jsonStr(tool, 'description').slice(0, 320),
          parameters: tool?.['parameters'] ?? {},
        },
      }))
      payload['tool_choice'] = 'auto'
    }
    if (supportsStreamUsage(kind)) {
      payload['stream_options'] = { include_usage: true }
    }
    // Stick a conversation to the same cache shard so repeated prefixes keep hitting.
    if (kind === 'openai') {
      payload['prompt_cache_key'] = this.promptCacheKey(messages)
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    }
    addAuthHeaders(headers, kind, key)
    const request = {
      url: chatEndpoint(baseUrlFor(provider), kind),
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    }

    const result: ChatResult = {
      text: '',
      reasoning: '',
      finish_reason: '',
      tool_calls: [],
      usage: { input_tokens: 0, output_tokens: 0, cached_tokens: 0 },
    }
    let buffer = ''
    const decoder = new StringDecoder('utf8')
    const accumulators = new Map<number, { id: string; name: string; args: string }>()
    const handleLine = (rawLine: string): void => {
      const line = trim(rawLine)
      if (line === '') return
      if (!startsWith(line, 'data:')) return
      const data = trim(line.slice(5))
      if (data === '[DONE]') return
      let chunk: Json = null
      try {
        chunk = JSON.parse(data)
      } catch {
        return
      }
      if (
        chunk !== null &&
        typeof chunk === 'object' &&
        'error' in chunk &&
        chunk['error'] !== null &&
        typeof chunk['error'] === 'object'
      ) {
        throw new NexusError(
          'E_PROVIDER',
          `${name}: ${jsonStr(chunk['error'], 'message', 'provider error')}`,
        )
      }
      if (chunk?.['usage'] && typeof chunk['usage'] === 'object') {
        result.usage.input_tokens = jsonInt(
          chunk['usage'],
          'prompt_tokens',
          result.usage.input_tokens,
        )
        result.usage.output_tokens = jsonInt(
          chunk['usage'],
          'completion_tokens',
          result.usage.output_tokens,
        )
        const details = chunk['usage']['prompt_tokens_details']
        if (details && typeof details === 'object') {
          result.usage.cached_tokens = jsonInt(details, 'cached_tokens', 0)
          result.usage.cached_in_input = true // prompt_tokens đã gồm cached_tokens
        }
      }
      const choices = Array.isArray(chunk?.['choices']) ? chunk['choices'] : []
      if (choices.length === 0) return
      const choice = choices[0]
      if (typeof choice?.['finish_reason'] === 'string') {
        result.finish_reason = choice['finish_reason']
      }
      const delta = choice?.['delta']
      if (!delta || typeof delta !== 'object') return
      if (typeof delta['content'] === 'string' && delta['content'] !== '') {
        const text = delta['content'] as string
        result.text += text
        onDelta?.(text, '')
      }
      let reasoning = ''
      if (typeof delta['reasoning_content'] === 'string') reasoning = delta['reasoning_content']
      else if (typeof delta['reasoning'] === 'string') reasoning = delta['reasoning']
      else if (typeof delta['thinking'] === 'string') reasoning = delta['thinking']
      if (reasoning === '' && Array.isArray(delta['reasoning_details'])) {
        for (const detail of delta['reasoning_details']) {
          if (detail === null || typeof detail !== 'object') continue
          const type = jsonStr(detail, 'type')
          if (type === 'reasoning.text' || type === 'reasoning.summary') {
            reasoning += jsonStr(detail, 'text')
          }
        }
      }
      if (reasoning !== '') {
        result.reasoning += reasoning
        onDelta?.('', reasoning)
      }
      if (Array.isArray(delta['tool_calls'])) {
        for (const call of delta['tool_calls']) {
          const index = jsonInt(call, 'index', 0)
          const accumulator = accumulators.get(index) ?? { id: '', name: '', args: '' }
          if (typeof call?.['id'] === 'string') accumulator.id = call['id']
          const functionEntry = call?.['function']
          if (functionEntry && typeof functionEntry === 'object') {
            if (typeof functionEntry['name'] === 'string') accumulator.name += functionEntry['name']
            if (typeof functionEntry['arguments'] === 'string')
              accumulator.args += functionEntry['arguments']
          }
          accumulators.set(index, accumulator)
        }
      }
    }
    const onData = (chunk: Buffer): boolean => {
      buffer += decoder.write(chunk)
      let start = 0
      for (;;) {
        const position = buffer.indexOf('\n', start)
        if (position === -1) break
        handleLine(buffer.slice(start, position))
        start = position + 1
      }
      if (start === buffer.length) buffer = ''
      else if (start > 0) buffer = buffer.slice(start)
      return true
    }
    const response = await httpRequest(request, onData, abort)
    buffer += decoder.end()
    if (buffer !== '') handleLine(buffer)
    ensureSuccess(response, name)
    for (const accumulator of [...accumulators.entries()].sort((a, b) => a[0] - b[0])) {
      const [, value] = accumulator
      const callName = value.name
      if (callName === '') continue
      result.tool_calls.push({
        id: value.id === '' ? `call-${uuid()}` : value.id,
        name: callName,
        arguments: parseToolArguments(value.args),
      })
    }
    return result
  }

  /* ---------------------------------------------------------------- anthropic */
  private async chatAnthropic(
    provider: Json,
    model: Json,
    messages: ChatMessage[],
    tools: Json,
    textMode: boolean,
    onDelta: DeltaCallback | undefined,
    abort: AbortSignal | undefined,
  ): Promise<ChatResult> {
    const name = providerName(provider)
    const key = this.apiKey(jsonStr(provider, 'id'))
    if (key === '') throw new NexusError('E_AUTH', `${name}: API key is missing`)
    let system = ''
    const converted: Json[] = []
    const pushMessage = (entry: Json): void => {
      const last = converted[converted.length - 1]
      if (last && last['role'] === entry['role']) {
        if (typeof last['content'] === 'string' && typeof entry['content'] === 'string') {
          last['content'] = `${last['content']}\n\n${entry['content']}`
          return
        }
        const parts: Json[] = []
        if (typeof last['content'] === 'string') {
          parts.push({ type: 'text', text: last['content'] })
        } else if (Array.isArray(last['content'])) {
          parts.push(...(last['content'] as Json[]))
        }
        if (typeof entry['content'] === 'string') {
          parts.push({ type: 'text', text: entry['content'] })
        } else if (Array.isArray(entry['content'])) {
          parts.push(...(entry['content'] as Json[]))
        }
        last['content'] = parts
        return
      }
      converted.push(entry)
    }
    for (const message of messages) {
      if (message.role === 'system') {
        if (system !== '') system += '\n\n'
        system += message.content
        continue
      }
      if (message.role === 'tool') {
        pushMessage({
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: message.tool_call_id ?? '',
              content: message.content,
            },
          ],
        })
        continue
      }
      if (
        message.role === 'assistant' &&
        Array.isArray(message.tool_calls) &&
        message.tool_calls.length > 0
      ) {
        const blocks: Json[] = []
        if (message.content !== '') blocks.push({ type: 'text', text: message.content })
        for (const call of message.tool_calls) {
          blocks.push({
            type: 'tool_use',
            id: jsonStr(call, 'id'),
            name: jsonStr(call, 'name'),
            input: 'arguments' in call ? (call['arguments'] ?? {}) : {},
          })
        }
        pushMessage({ role: 'assistant', content: blocks })
        continue
      }
      if (message.role === 'user' && Array.isArray(message.images) && message.images.length > 0) {
        const blocks: Json[] = []
        if (message.content !== '') blocks.push({ type: 'text', text: message.content })
        for (const image of message.images) {
          const data = typeof image?.['base64'] === 'string' ? image['base64'] : ''
          if (data === '') continue
          const mediaType =
            typeof image?.['mimeType'] === 'string' ? image['mimeType'] : 'image/png'
          blocks.push({ type: 'image', source: { type: 'base64', media_type: mediaType, data } })
        }
        pushMessage({ role: 'user', content: blocks })
        continue
      }
      pushMessage({
        role: message.role === 'assistant' ? 'assistant' : 'user',
        content: message.content,
      })
    }
    const payload: Record<string, Json> = {
      model: modelWireId(model),
      max_tokens: jsonInt(model, 'maxOutputTokens', 8192),
      temperature: jsonDouble(model, 'temperature', 0.2),
      stream: true,
      messages: converted,
    }
    const base = baseUrlFor(provider)
    const cache = promptCacheEnabled(this.store, base)
    const cacheControl = { type: 'ephemeral' }
    if (system !== '') {
      if (cache) {
        payload['system'] = [{ type: 'text', text: system, cache_control: cacheControl }]
      } else {
        payload['system'] = system
      }
    }
    if (!textMode && Array.isArray(tools) && tools.length > 0) {
      const toolPayload = tools.map((tool) => ({
        name: jsonStr(tool, 'name'),
        description: jsonStr(tool, 'description'),
        input_schema: tool?.['parameters'] ?? {},
      }))
      if (cache && toolPayload.length > 0) {
        ;(toolPayload[toolPayload.length - 1] as Record<string, Json>)['cache_control'] =
          cacheControl
      }
      payload['tools'] = toolPayload
    }
    if (cache && converted.length > 0) {
      const last = converted[converted.length - 1] as Record<string, Json>
      if (typeof last['content'] === 'string') {
        last['content'] = [{ type: 'text', text: last['content'], cache_control: cacheControl }]
      } else if (Array.isArray(last['content']) && last['content'].length > 0) {
        ;(last['content'][last['content'].length - 1] as Record<string, Json>)['cache_control'] =
          cacheControl
      }
    }
    const request = {
      url: `${base}/messages`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        Accept: 'text/event-stream',
      },
      body: JSON.stringify(payload),
    }
    const result: ChatResult = {
      text: '',
      reasoning: '',
      finish_reason: '',
      tool_calls: [],
      usage: { input_tokens: 0, output_tokens: 0, cached_tokens: 0 },
    }
    let buffer = ''
    const decoder = new StringDecoder('utf8')
    const accumulators = new Map<number, { id: string; name: string; args: string }>()
    const handleLine = (rawLine: string): void => {
      const line = trim(rawLine)
      if (!startsWith(line, 'data:')) return
      const data = trim(line.slice(5))
      if (data === '' || data === '[DONE]') return
      let event: Json = null
      try {
        event = JSON.parse(data)
      } catch {
        return
      }
      const type = jsonStr(event, 'type')
      if (type === 'error') {
        const errorObject = (event?.['error'] ?? {}) as Json
        throw new NexusError(
          'E_PROVIDER',
          `${name}: ${jsonStr(errorObject, 'message', 'stream error')}`,
        )
      }
      if (type === 'message_start' && event?.['message'] && typeof event['message'] === 'object') {
        const usage = (event['message']['usage'] ?? {}) as Json
        result.usage.input_tokens = jsonInt(usage, 'input_tokens', 0)
        result.usage.cached_tokens = jsonInt(usage, 'cache_read_input_tokens', 0)
        result.usage.cached_in_input = false // Anthropic: cache_read nằm ngoài input_tokens
        return
      }
      if (type === 'content_block_start') {
        const index = jsonInt(event, 'index', 0)
        const block = (event?.['content_block'] ?? {}) as Json
        const blockType = jsonStr(block, 'type')
        if (blockType === 'tool_use') {
          accumulators.set(index, {
            id: jsonStr(block, 'id'),
            name: jsonStr(block, 'name'),
            args: '',
          })
        } else if (
          blockType === 'text' &&
          typeof block?.['text'] === 'string' &&
          block['text'] !== ''
        ) {
          result.text += block['text']
          onDelta?.(block['text'], '')
        }
        return
      }
      if (type === 'content_block_delta') {
        const index = jsonInt(event, 'index', 0)
        const delta = (event?.['delta'] ?? {}) as Json
        const deltaType = jsonStr(delta, 'type')
        if (deltaType === 'text_delta') {
          const text = jsonStr(delta, 'text')
          if (text !== '') {
            result.text += text
            onDelta?.(text, '')
          }
        } else if (deltaType === 'thinking_delta') {
          const thinking = jsonStr(delta, 'thinking')
          if (thinking !== '') {
            result.reasoning += thinking
            onDelta?.('', thinking)
          }
        } else if (deltaType === 'input_json_delta') {
          const accumulator = accumulators.get(index) ?? { id: '', name: '', args: '' }
          accumulator.args += jsonStr(delta, 'partial_json')
          accumulators.set(index, accumulator)
        }
        return
      }
      if (type === 'message_delta') {
        const delta = (event?.['delta'] ?? {}) as Json
        if (typeof delta['stop_reason'] === 'string') {
          result.finish_reason = delta['stop_reason']
        }
        const usage = (event?.['usage'] ?? {}) as Json
        result.usage.output_tokens = jsonInt(usage, 'output_tokens', result.usage.output_tokens)
      }
    }
    const onData = (chunk: Buffer): boolean => {
      buffer += decoder.write(chunk)
      let start = 0
      for (;;) {
        const position = buffer.indexOf('\n', start)
        if (position === -1) break
        handleLine(buffer.slice(start, position))
        start = position + 1
      }
      if (start === buffer.length) buffer = ''
      else if (start > 0) buffer = buffer.slice(start)
      return true
    }
    const response = await httpRequest(request, onData, abort)
    buffer += decoder.end()
    if (buffer !== '') handleLine(buffer)
    ensureSuccess(response, name)
    for (const accumulator of [...accumulators.values()]) {
      result.tool_calls.push({
        id: accumulator.id === '' ? `call-${uuid()}` : accumulator.id,
        name: accumulator.name,
        arguments: parseToolArguments(accumulator.args),
      })
    }
    return result
  }

  /* -------------------------------------------------------------------- gemini */
  private async chatGemini(
    provider: Json,
    model: Json,
    messages: ChatMessage[],
    tools: Json,
    textMode: boolean,
    onDelta: DeltaCallback | undefined,
    abort: AbortSignal | undefined,
  ): Promise<ChatResult> {
    const name = providerName(provider)
    const key = this.apiKey(jsonStr(provider, 'id'))
    if (key === '') throw new NexusError('E_AUTH', `${name}: API key is missing`)
    let system = ''
    const contents: Json[] = []
    for (const message of messages) {
      if (message.role === 'system') {
        if (system !== '') system += '\n\n'
        system += message.content
        continue
      }
      const parts: Json[] = []
      if (message.role === 'tool') {
        parts.push({
          functionResponse: {
            name: message.name && message.name !== '' ? message.name : 'tool',
            response: { result: message.content },
          },
        })
        contents.push({ role: 'user', parts })
        continue
      }
      if (message.content !== '') parts.push({ text: message.content })
      if (Array.isArray(message.tool_calls)) {
        for (const call of message.tool_calls) {
          parts.push({
            functionCall: {
              name: jsonStr(call, 'name'),
              args: 'arguments' in call ? (call['arguments'] ?? {}) : {},
            },
          })
        }
      }
      if (Array.isArray(message.images)) {
        for (const image of message.images) {
          const data = typeof image?.['base64'] === 'string' ? image['base64'] : ''
          if (data === '') continue
          const mimeType = typeof image?.['mimeType'] === 'string' ? image['mimeType'] : 'image/png'
          parts.push({ inlineData: { mimeType, data } })
        }
      }
      if (parts.length === 0) continue
      contents.push({ role: message.role === 'assistant' ? 'model' : 'user', parts })
    }
    const generation: Record<string, Json> = {
      temperature: jsonDouble(model, 'temperature', 0.2),
      maxOutputTokens: jsonInt(model, 'maxOutputTokens', 8192),
    }
    const payload: Record<string, Json> = { contents, generationConfig: generation }
    if (system !== '') payload['systemInstruction'] = { parts: [{ text: system }] }
    if (!textMode && Array.isArray(tools) && tools.length > 0) {
      const declarations = tools.map((tool) => ({
        name: jsonStr(tool, 'name'),
        description: jsonStr(tool, 'description'),
        parameters: tool?.['parameters'] ?? {},
      }))
      payload['tools'] = [{ functionDeclarations: declarations }]
    }
    const wire = modelWireId(model)
    let url = `${baseUrlFor(provider)}/models/${wire}:streamGenerateContent?alt=sse`
    url = authQueryKey(url, key)
    const request = {
      url,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body: JSON.stringify(payload),
    }
    const result: ChatResult = {
      text: '',
      reasoning: '',
      finish_reason: '',
      tool_calls: [],
      usage: { input_tokens: 0, output_tokens: 0, cached_tokens: 0 },
    }
    let buffer = ''
    const decoder = new StringDecoder('utf8')
    const handleLine = (rawLine: string): void => {
      const line = trim(rawLine)
      if (!startsWith(line, 'data:')) return
      const data = trim(line.slice(5))
      if (data === '' || data === '[DONE]') return
      let event: Json = null
      try {
        event = JSON.parse(data)
      } catch {
        return
      }
      if (event !== null && typeof event === 'object' && 'error' in event) {
        throw new NexusError(
          'E_PROVIDER',
          `${name}: ${jsonStr(event['error'], 'message', 'provider error')}`,
        )
      }
      const usage = (event?.['usageMetadata'] ?? {}) as Json
      result.usage.input_tokens = jsonInt(usage, 'promptTokenCount', result.usage.input_tokens)
      result.usage.output_tokens = jsonInt(
        usage,
        'candidatesTokenCount',
        result.usage.output_tokens,
      )
      result.usage.cached_tokens = jsonInt(
        usage,
        'cachedContentTokenCount',
        result.usage.cached_tokens,
      )
      result.usage.cached_in_input = true // promptTokenCount đã gồm cached content
      const candidates = Array.isArray(event?.['candidates']) ? (event['candidates'] as Json[]) : []
      if (candidates.length === 0) return
      const candidate = candidates[0]
      if (typeof candidate?.['finishReason'] === 'string') {
        result.finish_reason = candidate['finishReason']
      }
      const candidateParts = Array.isArray(candidate?.['content']?.['parts'])
        ? (candidate['content']['parts'] as Json[])
        : []
      for (const part of candidateParts) {
        if (part === null || typeof part !== 'object') continue
        if (typeof part['text'] === 'string' && part['text'] !== '') {
          const text = part['text'] as string
          if (jsonBool(part, 'thought')) {
            result.reasoning += text
            onDelta?.('', text)
          } else {
            result.text += text
            onDelta?.(text, '')
          }
        }
        const call = part['functionCall']
        if (call !== null && typeof call === 'object') {
          result.tool_calls.push({
            id: `call-${uuid()}`,
            name: jsonStr(call, 'name'),
            arguments:
              'args' in call && call['args'] !== null && typeof call['args'] === 'object'
                ? call['args']
                : {},
          })
        }
      }
    }
    const onData = (chunk: Buffer): boolean => {
      buffer += decoder.write(chunk)
      let start = 0
      for (;;) {
        const position = buffer.indexOf('\n', start)
        if (position === -1) break
        handleLine(buffer.slice(start, position))
        start = position + 1
      }
      if (start === buffer.length) buffer = ''
      else if (start > 0) buffer = buffer.slice(start)
      return true
    }
    const response = await httpRequest(request, onData, abort)
    buffer += decoder.end()
    if (buffer !== '') handleLine(buffer)
    ensureSuccess(response, name)
    return result
  }

  /* -------------------------------------------------------------------- ollama */
  private async chatOllama(
    provider: Json,
    model: Json,
    messages: ChatMessage[],
    tools: Json,
    textMode: boolean,
    onDelta: DeltaCallback | undefined,
    abort: AbortSignal | undefined,
  ): Promise<ChatResult> {
    const name = providerName(provider)
    const payload: Record<string, Json> = {
      model: modelWireId(model),
      stream: true,
      options: { temperature: jsonDouble(model, 'temperature', 0.2) },
    }
    const converted: Json[] = []
    for (const message of messages) {
      const entry: Record<string, Json> = { role: message.role, content: message.content }
      if (
        message.role === 'assistant' &&
        Array.isArray(message.tool_calls) &&
        message.tool_calls.length > 0
      ) {
        entry['tool_calls'] = message.tool_calls.map((call) => ({
          function: {
            name: jsonStr(call, 'name'),
            arguments: 'arguments' in call ? (call['arguments'] ?? {}) : {},
          },
        }))
      }
      if (message.role === 'user' && Array.isArray(message.images) && message.images.length > 0) {
        const images = message.images
          .map((image) => (typeof image?.['base64'] === 'string' ? image['base64'] : ''))
          .filter((data) => data !== '')
        if (images.length > 0) entry['images'] = images
      }
      if (message.role === 'tool' && message.name) entry['tool_name'] = message.name
      converted.push(entry)
    }
    payload['messages'] = converted
    if (!textMode && Array.isArray(tools) && tools.length > 0) {
      payload['tools'] = tools.map((tool) => ({
        type: 'function',
        function: {
          name: jsonStr(tool, 'name'),
          description: jsonStr(tool, 'description').slice(0, 320),
          parameters: tool?.['parameters'] ?? {},
        },
      }))
    }
    const request = {
      url: `${baseUrlFor(provider)}/api/chat`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body: JSON.stringify(payload),
    }
    const result: ChatResult = {
      text: '',
      reasoning: '',
      finish_reason: '',
      tool_calls: [],
      usage: { input_tokens: 0, output_tokens: 0, cached_tokens: 0 },
    }
    let buffer = ''
    const decoder = new StringDecoder('utf8')
    const seenCalls = new Set<string>()
    const handleLine = (rawLine: string): void => {
      const line = trim(rawLine)
      if (line === '') return
      let event: Json = null
      try {
        event = JSON.parse(line)
      } catch {
        return
      }
      if (event !== null && typeof event === 'object' && 'error' in event) {
        throw new NexusError('E_PROVIDER', `${name}: ${jsonStr(event, 'error', 'provider error')}`)
      }
      const message = event?.['message']
      if (message !== null && typeof message === 'object') {
        const text = jsonStr(message, 'content')
        if (text !== '') {
          result.text += text
          onDelta?.(text, '')
        }
        const thinking = jsonStr(message, 'thinking')
        if (thinking !== '') {
          result.reasoning += thinking
          onDelta?.('', thinking)
        }
        if (Array.isArray(message['tool_calls'])) {
          for (const call of message['tool_calls']) {
            const fn = (call?.['function'] ?? {}) as Json
            const argumentsValue = fn?.['arguments'] ?? {}
            const signature = `${jsonStr(fn, 'name')}|${JSON.stringify(argumentsValue)}`
            if (seenCalls.has(signature)) continue
            seenCalls.add(signature)
            result.tool_calls.push({
              id: `call-${uuid()}`,
              name: jsonStr(fn, 'name'),
              arguments: argumentsValue,
            })
          }
        }
      }
      if (event?.['done'] === true) {
        result.finish_reason = jsonStr(event, 'done_reason', 'stop')
        result.usage.input_tokens = jsonInt(event, 'prompt_eval_count', result.usage.input_tokens)
        result.usage.output_tokens = jsonInt(event, 'eval_count', result.usage.output_tokens)
      }
    }
    const onData = (chunk: Buffer): boolean => {
      buffer += decoder.write(chunk)
      let start = 0
      for (;;) {
        const position = buffer.indexOf('\n', start)
        if (position === -1) break
        handleLine(buffer.slice(start, position))
        start = position + 1
      }
      if (start === buffer.length) buffer = ''
      else if (start > 0) buffer = buffer.slice(start)
      return true
    }
    const response = await httpRequest(request, onData, abort)
    buffer += decoder.end()
    if (buffer !== '') handleLine(buffer)
    ensureSuccess(response, name)
    return result
  }
}
