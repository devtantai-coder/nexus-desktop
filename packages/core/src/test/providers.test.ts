import assert from 'node:assert/strict'
import { test } from 'node:test'

import { Providers } from '../providers.ts'

test('providers: registry defaults', () => {
  assert.equal(Providers.defaultBaseUrl('openrouter'), 'https://openrouter.ai/api/v1')
  assert.equal(Providers.defaultBaseUrl('lmstudio'), 'http://127.0.0.1:1234/v1')
  assert.equal(Providers.defaultBaseUrl('xai'), 'https://api.x.ai/v1')
  assert.ok(Providers.defaultBaseUrl('azure-openai').includes('openai.azure.com'))
})

test('providers: defaults_for_model grok-4 ≥ 128k', () => {
  const [context] = Providers.defaultsForModel('grok-4')
  assert.ok(context >= 128000)
})

test('providers: reasoning inference by id', () => {
  assert.equal(Providers.inferSupportsReasoning('gpt-5'), true)
  assert.equal(Providers.inferSupportsReasoning('deepseek-r1'), true)
  assert.equal(Providers.inferSupportsReasoning('glm-4.6-air'), true)
  assert.equal(Providers.inferSupportsReasoning('Claude-4-Sonnet'), true)
  assert.equal(Providers.inferSupportsReasoning('gpt-4o-mini'), false)
  assert.equal(Providers.inferSupportsReasoning('llama-3.1-8b'), false)
  assert.equal(Providers.inferSupportsReasoning('gpt-6.2-astra'), true)
  assert.equal(Providers.inferSupportsReasoning('claude-opus-5-5'), true)
  assert.equal(Providers.inferSupportsReasoning('claude-fable-5-2'), true)
  assert.equal(Providers.inferSupportsReasoning('gemini-4-neon'), true)
  assert.equal(Providers.inferSupportsReasoning('gemini-3.8-flash'), true)
  assert.equal(Providers.inferSupportsReasoning('deepseek-flash'), true)
  assert.equal(Providers.inferSupportsReasoning('kimi-k3.1-pro'), true)
  assert.equal(Providers.inferSupportsReasoning('grok-4.7'), true)
  assert.equal(Providers.inferSupportsReasoning('qwen3.7-plus'), true)
  assert.equal(Providers.inferSupportsReasoning('MiniMax-M3'), true)
})

test('providers: defaults_for_model covers current generation', () => {
  const [gpt6] = Providers.defaultsForModel('gpt-6.2-astra')
  assert.ok(gpt6 >= 1000000)
  const [gemini4] = Providers.defaultsForModel('gemini-4-neon')
  assert.ok(gemini4 >= 1000000)
  const [claude5] = Providers.defaultsForModel('claude-sonnet-5-5')
  assert.ok(claude5 >= 1000000)
  const [grok] = Providers.defaultsForModel('grok-4.7')
  assert.ok(grok >= 500000)
  const [flash] = Providers.defaultsForModel('deepseek-flash')
  assert.ok(flash >= 1000000)
})
