import { getEncoding, type Tiktoken, type TiktokenEncoding } from 'js-tiktoken'

const O200K_MODEL = /(?:^|[-/])(gpt-4o|gpt-4\.1|gpt-5|o[134](?:-|$)|chatgpt-4o|gpt-oss)/i

const cache = new Map<TiktokenEncoding, Tiktoken | null>()

export function encodingForModel(modelId = ''): TiktokenEncoding {
  return O200K_MODEL.test(modelId) ? 'o200k_base' : 'cl100k_base'
}

function encoder(name: TiktokenEncoding): Tiktoken | null {
  if (cache.has(name)) return cache.get(name) ?? null
  let value: Tiktoken | null
  try {
    value = getEncoding(name)
  } catch {
    value = null
  }
  cache.set(name, value)
  return value
}

/** Đếm token thật bằng BPE (tiktoken); rơi về ước lượng ký tự khi encoder lỗi. */
export function countTokens(text: string, modelId = ''): number {
  if (text === '') return 0
  const instance = encoder(encodingForModel(modelId))
  if (instance === null) return Math.ceil(text.length / 4)
  try {
    return instance.encode(text).length
  } catch {
    return Math.ceil(text.length / 4)
  }
}

export function shrinkToTokens(text: string, maxTokens: number, modelId = ''): string {
  if (maxTokens <= 0 || text === '') return text
  const instance = encoder(encodingForModel(modelId))
  if (instance === null) {
    const charBudget = Math.max(maxTokens * 4, 256)
    return text.length <= charBudget ? text : truncateChars(text, charBudget)
  }
  try {
    const tokens = instance.encode(text)
    if (tokens.length <= maxTokens) return text
    const head = Math.max(Math.floor(maxTokens * 0.6), 1)
    const tail = Math.max(maxTokens - head, 1)
    const prefix = instance.decode(tokens.slice(0, head))
    const suffix = instance.decode(tokens.slice(Math.max(tokens.length - tail, 0)))
    const marker = `\n…[token budget ${maxTokens}; ${tokens.length} tokens]…\n`
    return `${prefix}${marker}${suffix}`
  } catch {
    const charBudget = Math.max(maxTokens * 4, 256)
    return text.length <= charBudget ? text : truncateChars(text, charBudget)
  }
}

const truncateChars = (text: string, maxChars: number): string => {
  if (text.length <= maxChars) return text
  const head = Math.max(Math.floor(maxChars * 0.6), 1)
  const tail = Math.max(maxChars - head, 1)
  return `${text.slice(0, head)}\n…[truncated ${text.length - maxChars} chars]…\n${text.slice(-tail)}`
}

export function countJsonTokens(value: unknown, modelId = ''): number {
  try {
    return countTokens(JSON.stringify(value ?? null), modelId)
  } catch {
    return 0
  }
}
