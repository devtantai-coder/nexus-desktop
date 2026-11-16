import type React from 'react'
import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Check, KeyRound, Loader2, Plus, RefreshCw, Star, Trash2 } from 'lucide-react'
import type { ProviderConfig, ProviderKind } from '@nexus/shared'
import { api, queryClient, qk, useAppStore } from '../../kernel'
import { Badge, Button, Dialog, Field, IconButton, Input, Select, Switch, cn } from '../ui'

/**
 * Bố cục theo DeepSeek Harness (settings-models):
 * rowCard viền l2 + radius 12, chấm credential 8px, nút trong hàng cao 28px radius 14,
 * editor nền module-platform, danh sách model dạng entry viền l2 radius 8.
 */

const KINDS: Array<{
  kind: ProviderKind
  label: string
  baseUrl: string
  needsKey: boolean
  local?: boolean
}> = [
  { kind: 'openai', label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', needsKey: true },
  { kind: 'anthropic', label: 'Anthropic', baseUrl: 'https://api.anthropic.com', needsKey: true },
  {
    kind: 'google',
    label: 'Google Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com',
    needsKey: true,
  },
  {
    kind: 'openrouter',
    label: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    needsKey: true,
  },
  { kind: 'deepseek', label: 'DeepSeek', baseUrl: 'https://api.deepseek.com', needsKey: true },
  { kind: 'groq', label: 'Groq', baseUrl: 'https://api.groq.com/openai/v1', needsKey: true },
  { kind: 'xai', label: 'xAI', baseUrl: 'https://api.x.ai/v1', needsKey: true },
  { kind: 'mistral', label: 'Mistral', baseUrl: 'https://api.mistral.ai/v1', needsKey: true },
  { kind: 'together', label: 'Together', baseUrl: 'https://api.together.xyz/v1', needsKey: true },
  {
    kind: 'fireworks',
    label: 'Fireworks',
    baseUrl: 'https://api.fireworks.ai/inference/v1',
    needsKey: true,
  },
  { kind: 'perplexity', label: 'Perplexity', baseUrl: 'https://api.perplexity.ai', needsKey: true },
  {
    kind: 'cohere',
    label: 'Cohere',
    baseUrl: 'https://api.cohere.ai/compatibility/v1',
    needsKey: true,
  },
  {
    kind: 'qwen',
    label: 'Qwen (DashScope)',
    baseUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
    needsKey: true,
  },
  { kind: 'moonshot', label: 'Moonshot', baseUrl: 'https://api.moonshot.ai/v1', needsKey: true },
  { kind: 'zai', label: 'Z.ai (GLM)', baseUrl: 'https://api.z.ai/api/paas/v4', needsKey: true },
  { kind: 'minimax', label: 'MiniMax', baseUrl: 'https://api.minimax.io/v1', needsKey: true },
  { kind: 'cerebras', label: 'Cerebras', baseUrl: 'https://api.cerebras.ai/v1', needsKey: true },
  {
    kind: 'deepinfra',
    label: 'DeepInfra',
    baseUrl: 'https://api.deepinfra.com/v1/openai',
    needsKey: true,
  },
  {
    kind: 'github-models',
    label: 'GitHub Models',
    baseUrl: 'https://models.inference.ai.azure.com',
    needsKey: true,
  },
  {
    kind: 'ollama',
    label: 'Ollama',
    baseUrl: 'http://localhost:11434',
    needsKey: false,
    local: true,
  },
  {
    kind: 'lmstudio',
    label: 'LM Studio',
    baseUrl: 'http://localhost:1234/v1',
    needsKey: false,
    local: true,
  },
  {
    kind: 'llamacpp',
    label: 'llama.cpp',
    baseUrl: 'http://localhost:8080/v1',
    needsKey: false,
    local: true,
  },
  {
    kind: 'vllm',
    label: 'vLLM',
    baseUrl: 'http://localhost:8000/v1',
    needsKey: false,
    local: true,
  },
  { kind: 'openai-compatible', label: 'OpenAI-compatible', baseUrl: '', needsKey: true },
  { kind: 'azure-openai', label: 'Azure OpenAI', baseUrl: '', needsKey: true },
]

const CHIP =
  'inline-flex h-7 min-w-0 items-center justify-center truncate rounded-[var(--radius-sm)] border px-2 text-[12px] transition-colors'

const CLOUD_KINDS = KINDS.filter((entry) => !entry.local)
const LOCAL_KINDS = KINDS.filter((entry) => entry.local)

function PresetChips({
  title,
  items,
  preset,
  onPick,
}: {
  title: string
  items: Array<(typeof KINDS)[number]>
  preset: string
  onPick: (entry: (typeof KINDS)[number]) => void
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[11px] font-medium uppercase tracking-[0.04em] text-[var(--text-faint)]">
        {title}
      </span>
      <div className="grid grid-cols-3 gap-1.5">
        {items.map((entry) => (
          <button
            key={entry.kind}
            type="button"
            onClick={() => onPick(entry)}
            className={cn(
              CHIP,
              preset === entry.kind
                ? 'border-[var(--border-strong)] bg-[var(--bg-active)] text-[var(--text)]'
                : 'border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)]',
            )}
          >
            {entry.label}
          </button>
        ))}
      </div>
    </div>
  )
}

function protocolLabel(kind: ProviderKind): string {
  if (kind === 'anthropic') return 'Messages'
  const entry = KINDS.find((candidate) => candidate.kind === kind)
  return entry ? entry.label : kind
}

function needsKey(kind: ProviderKind): boolean {
  return KINDS.find((entry) => entry.kind === kind)?.needsKey ?? true
}

function ProviderRow({ provider }: { provider: ProviderConfig }): React.JSX.Element {
  const toast = useAppStore((state) => state.toast)
  const [keyDraft, setKeyDraft] = useState('')
  const [busy, setBusy] = useState<'key' | 'test' | 'models' | null>(null)
  const [latency, setLatency] = useState<number | null>(null)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [keyOpen, setKeyOpen] = useState(false)

  const keyRequired = needsKey(provider.kind)
  const showKeyField = keyRequired && (keyOpen || !provider.hasApiKey)

  const saveKey = async (): Promise<void> => {
    if (!keyDraft.trim()) return
    setBusy('key')
    try {
      await api.providers.setKey(provider.id, keyDraft.trim())
      setKeyDraft('')
      setKeyOpen(false)
      await queryClient.invalidateQueries({ queryKey: qk.providers })
      toast({ level: 'success', title: 'Đã lưu API key' })
    } catch (error) {
      toast({ level: 'error', title: 'Không lưu được key', body: (error as Error).message })
    } finally {
      setBusy(null)
    }
  }

  const test = async (): Promise<void> => {
    setBusy('test')
    try {
      const result = await api.providers.test(provider.id)
      setLatency(result.latencyMs ?? null)
      toast({
        level: result.ok ? 'success' : 'error',
        title: result.ok ? `Kết nối OK · ${result.latencyMs ?? '?'}ms` : 'Kết nối thất bại',
        ...(result.ok
          ? { body: result.models?.length ? `${result.models.length} model khả dụng` : undefined }
          : { body: result.error?.message }),
      })
    } catch (error) {
      toast({ level: 'error', title: 'Không kiểm tra được', body: (error as Error).message })
    } finally {
      setBusy(null)
    }
  }

  const discover = async (): Promise<void> => {
    setBusy('models')
    try {
      const found = await api.providers.discover(provider.id)
      for (const model of found) {
        await api.models.save({
          providerId: provider.id,
          modelId: model.id,
          ...(model.displayName ? { displayName: model.displayName } : {}),
          ...(model.contextWindow ? { contextWindow: model.contextWindow } : {}),
          ...(model.maxOutputTokens ? { maxOutputTokens: model.maxOutputTokens } : {}),
          supportsReasoning: model.supportsReasoning,
        })
      }
      await queryClient.invalidateQueries({ queryKey: qk.models })
      await queryClient.invalidateQueries({ queryKey: qk.providers })
      toast({ level: 'success', title: `Đã thêm ${found.length} model`, body: provider.name })
    } catch (error) {
      toast({ level: 'error', title: 'Không phát hiện được model', body: (error as Error).message })
    } finally {
      setBusy(null)
    }
  }

  const toggle = async (enabled: boolean): Promise<void> => {
    await api.providers
      .save({ id: provider.id, kind: provider.kind, name: provider.name, enabled })
      .catch((error: Error) =>
        toast({ level: 'error', title: 'Không cập nhật được', body: error.message }),
      )
    await queryClient.invalidateQueries({ queryKey: qk.providers })
  }

  const remove = async (): Promise<void> => {
    setConfirmRemove(false)
    await api.providers
      .remove(provider.id)
      .catch((error: Error) =>
        toast({ level: 'error', title: 'Không xoá được', body: error.message }),
      )
    await queryClient.invalidateQueries({ queryKey: qk.providers })
    await queryClient.invalidateQueries({ queryKey: qk.models })
  }

  return (
    <li
      className={cn(
        'flex flex-col gap-2 rounded-[var(--radius-xl)] border border-[var(--border)] bg-[var(--bg-surface)] px-3.5 py-2.5 transition-colors hover:border-[var(--border-strong)]',
        provider.enabled ? '' : 'opacity-55',
      )}
    >
      <div className="flex items-center gap-2">
        <span
          aria-hidden
          className={cn(
            'h-2 w-2 shrink-0 rounded-full',
            provider.hasApiKey || !keyRequired ? 'bg-[var(--success)]' : 'bg-[var(--warning)]',
          )}
        />
        <span className="truncate text-[14px] font-medium leading-[22px] text-[var(--text)]">
          {provider.name}
        </span>
        <Badge>{protocolLabel(provider.kind)}</Badge>
        <span className="ml-auto" />
        {latency !== null ? (
          <span className="shrink-0 font-mono text-[11px] tabular-nums text-[var(--text-faint)]">
            {latency}ms
          </span>
        ) : null}
        <Switch
          ariaLabel={provider.enabled ? 'Tắt nhà cung cấp' : 'Bật nhà cung cấp'}
          checked={provider.enabled}
          onCheckedChange={(value) => void toggle(value)}
        />
      </div>

      <div className="flex items-center gap-1.5">
        <span className="min-w-0 flex-1 truncate font-mono text-[12px] leading-[18px] text-[var(--text-faint)]">
          {provider.baseUrl}
        </span>
        <Button size="xs" variant="ghost" onClick={() => void test()} disabled={busy !== null}>
          {busy === 'test' ? (
            <Loader2 size={12} className="animate-spin" />
          ) : (
            <RefreshCw size={12} />
          )}
          Kiểm tra
        </Button>
        <Button size="xs" variant="ghost" onClick={() => void discover()} disabled={busy !== null}>
          {busy === 'models' ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
          Model
        </Button>
        <IconButton
          label={`Xoá ${provider.name}`}
          className="hover:text-[var(--danger)]"
          onClick={() => setConfirmRemove(true)}
        >
          <Trash2 size={13} />
        </IconButton>
      </div>

      {showKeyField ? (
        <div className="flex items-center gap-2">
          <div className="relative flex min-w-0 flex-1 items-center">
            <KeyRound
              size={12}
              className="pointer-events-none absolute left-2.5 text-[var(--text-faint)]"
            />
            <Input
              type="password"
              autoFocus={keyOpen}
              value={keyDraft}
              onChange={(event) => setKeyDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void saveKey()
                if (event.key === 'Escape' && provider.hasApiKey) setKeyOpen(false)
              }}
              placeholder={provider.hasApiKey ? 'Dán key mới' : 'Dán API key để kết nối'}
              className="h-8 pl-8 text-[13px]"
            />
          </div>
          <Button
            size="xs"
            variant="secondary"
            disabled={!keyDraft.trim() || busy !== null}
            onClick={() => void saveKey()}
          >
            {busy === 'key' ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
            Lưu key
          </Button>
        </div>
      ) : keyRequired ? (
        <div className="flex items-center gap-1.5 text-[12px] leading-[18px] text-[var(--text-faint)]">
          <KeyRound size={12} />
          <span className="min-w-0 truncate">
            Key đã lưu{provider.apiKeyHint ? ` · ${provider.apiKeyHint}` : ''}
          </span>
          <button
            type="button"
            className="ml-auto shrink-0 rounded-[var(--radius-xs)] px-1.5 py-0.5 text-[12px] text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text)]"
            onClick={() => setKeyOpen(true)}
          >
            Đổi key
          </button>
        </div>
      ) : null}

      <Dialog
        open={confirmRemove}
        onOpenChange={setConfirmRemove}
        title={`Xoá ${provider.name}?`}
        description="Toàn bộ model của nhà cung cấp này cũng bị xoá. Không thể hoàn tác."
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmRemove(false)}>
              Huỷ
            </Button>
            <Button variant="danger" icon={<Trash2 size={13} />} onClick={() => void remove()}>
              Xoá
            </Button>
          </>
        }
      />
    </li>
  )
}

function AddProvider(): React.JSX.Element {
  const toast = useAppStore((state) => state.toast)
  const [open, setOpen] = useState(false)
  const [preset, setPreset] = useState<string>('')
  const [kind, setKind] = useState<ProviderKind>('openai-compatible')
  const [name, setName] = useState('')
  const [baseUrl, setBaseUrl] = useState('https://api.openai.com/v1')
  const [apiKey, setApiKey] = useState('')
  const [model, setModel] = useState('')
  const [saving, setSaving] = useState(false)

  const choosePreset = (entry: (typeof KINDS)[number]): void => {
    setPreset(entry.kind)
    setKind(entry.kind)
    setName(entry.label)
    setBaseUrl(entry.baseUrl || baseUrl)
  }

  const reset = (): void => {
    setOpen(false)
    setPreset('')
    setKind('openai-compatible')
    setName('')
    setBaseUrl('https://api.openai.com/v1')
    setApiKey('')
    setModel('')
  }

  const save = async (): Promise<void> => {
    if (!baseUrl.trim()) return
    setSaving(true)
    try {
      const created = await api.providers.save({
        kind,
        name: name.trim() || new URL(baseUrl.trim()).host,
        baseUrl: baseUrl.trim(),
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
        enabled: true,
      })
      if (model.trim()) {
        await api.models.save({
          providerId: created.id,
          modelId: model.trim(),
          displayName: model.trim(),
          supportsReasoning: false,
        })
      }
      await queryClient.invalidateQueries({ queryKey: qk.providers })
      await queryClient.invalidateQueries({ queryKey: qk.models })
      toast({
        level: 'success',
        title: 'Đã thêm nhà cung cấp',
        body: model.trim() ? undefined : 'Bấm “Model” để phát hiện danh sách model.',
      })
      reset()
    } catch (error) {
      toast({ level: 'error', title: 'Không thêm được', body: (error as Error).message })
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex h-11 w-full items-center justify-center gap-1.5 rounded-[var(--radius-xl)] border border-dashed border-[var(--border-strong)] text-[13px] text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text)]"
      >
        <Plus size={14} />
        Thêm nhà cung cấp
      </button>

      <Dialog
        open={open}
        onOpenChange={(next) => (next ? setOpen(true) : reset())}
        title="Thêm nhà cung cấp"
        description="Chọn gợi ý bên dưới hoặc nhập endpoint riêng."
        width={560}
        footer={
          <>
            <Button variant="ghost" onClick={reset}>
              Huỷ
            </Button>
            <Button
              variant="primary"
              loading={saving}
              disabled={!baseUrl.trim()}
              onClick={() => void save()}
            >
              Thêm
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <PresetChips title="Cloud" items={CLOUD_KINDS} preset={preset} onPick={choosePreset} />
          <PresetChips title="Local" items={LOCAL_KINDS} preset={preset} onPick={choosePreset} />

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Tên">
              <Input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="vd. My Gateway"
              />
            </Field>
            <Field label="Model" hint="Tuỳ chọn · để trống rồi bấm “Model”">
              <Input
                value={model}
                onChange={(event) => setModel(event.target.value)}
                placeholder="vd. gpt-4o-mini"
                className="font-mono text-[12.5px]"
              />
            </Field>
            <Field
              label="API URL"
              hint={kind === 'anthropic' ? 'POST /v1/messages' : 'POST /chat/completions'}
              className="sm:col-span-2"
            >
              <Input
                value={baseUrl}
                onChange={(event) => setBaseUrl(event.target.value)}
                placeholder="https://…"
                className="font-mono text-[12.5px]"
              />
            </Field>
            <Field
              label={needsKey(kind) ? 'API key' : 'API key (tuỳ chọn)'}
              hint="Lưu trong keychain hệ thống."
              className="sm:col-span-2"
            >
              <Input
                type="password"
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void save()
                }}
                placeholder="sk-…"
                className="font-mono text-[12.5px]"
              />
            </Field>
          </div>
        </div>
      </Dialog>
    </>
  )
}

export function ProvidersPanel(): React.JSX.Element {
  const toast = useAppStore((state) => state.toast)
  const { data: providers = [] } = useQuery({
    queryKey: qk.providers,
    queryFn: () => api.providers.list(),
  })
  const { data: models = [] } = useQuery({ queryKey: qk.models, queryFn: () => api.models.list() })
  const defaultModel = models.find((model) => model.isDefault)

  const modelGroups = useMemo(() => {
    const groups = new Map<
      string,
      {
        key: string
        displayName: string
        modelId: string
        providerId: string
        variants: string[]
        contextWindow: number
        ids: string[]
        isDefault: boolean
      }
    >()
    for (const model of models) {
      const key = `${model.providerId}::${model.modelId}`
      const group = groups.get(key)
      if (group) {
        group.variants.push(model.variant || 'mặc định')
        group.ids.push(model.id)
        group.isDefault ||= model.isDefault
        group.contextWindow = Math.max(group.contextWindow, model.contextWindow)
      } else {
        groups.set(key, {
          key,
          displayName: model.displayName,
          modelId: model.modelId,
          providerId: model.providerId,
          variants: [model.variant || 'mặc định'],
          contextWindow: model.contextWindow,
          ids: [model.id],
          isDefault: model.isDefault,
        })
      }
    }
    return [...groups.values()].map((group) => ({
      ...group,
      variants: [...new Set(group.variants)].sort((a, b) =>
        a === 'mặc định' ? 1 : b === 'mặc định' ? -1 : a.localeCompare(b),
      ),
    }))
  }, [models])

  const setDefault = async (id: string): Promise<void> => {
    await api.models
      .setDefault(id)
      .catch((error: Error) =>
        toast({ level: 'error', title: 'Không đặt được model', body: error.message }),
      )
    await queryClient.invalidateQueries({ queryKey: qk.models })
  }

  const removeModels = async (ids: string[]): Promise<void> => {
    for (const id of ids) {
      await api.models
        .remove(id)
        .catch((error: Error) =>
          toast({ level: 'error', title: 'Không xoá được model', body: error.message }),
        )
    }
    await queryClient.invalidateQueries({ queryKey: qk.models })
  }

  const providerName = (id: string): string =>
    providers.find((entry) => entry.id === id)?.name ?? 'provider'

  return (
    <div className="flex max-w-[720px] flex-col gap-3">
      <header className="flex flex-col gap-1">
        <h2 className="m-0 text-[16px] font-medium leading-6 text-[var(--text)]">Nhà cung cấp</h2>
        <p className="m-0 text-[14px] leading-[22px] text-[var(--text-muted)]">
          Kết nối endpoint OpenAI Chat Completions hoặc Anthropic Messages, rồi chọn model mặc định.
        </p>
      </header>

      <section className="flex flex-col gap-3 rounded-[var(--radius-xl)] border border-[var(--border)] bg-[var(--bg-surface)] px-3.5 py-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-[12px] font-medium leading-[18px] text-[var(--text-muted)]">
              Model mặc định
            </div>
            <div className="mt-0.5 flex items-center gap-1.5">
              <Star
                size={13}
                className={
                  defaultModel
                    ? 'shrink-0 fill-current text-[var(--warning)]'
                    : 'shrink-0 text-[var(--text-faint)]'
                }
              />
              <span className="truncate text-[14px] font-medium leading-[22px] text-[var(--text)]">
                {defaultModel?.displayName ?? 'Chưa chọn model'}
              </span>
              {defaultModel?.variant ? <Badge>{defaultModel.variant}</Badge> : null}
            </div>
            <div className="mt-0.5 truncate font-mono text-[12px] leading-[18px] text-[var(--text-faint)]">
              {defaultModel
                ? `${providerName(defaultModel.providerId)} · ${Math.round(defaultModel.contextWindow / 1024)}k ctx · ${modelGroups.length} model`
                : 'Thêm nhà cung cấp rồi phát hiện model để bắt đầu.'}
            </div>
          </div>
          {modelGroups.length ? (
            <Select
              ariaLabel="Chọn model mặc định"
              value={defaultModel?.id}
              placeholder="Chọn model"
              options={modelGroups.map((group) => ({
                value: group.ids[0] ?? '',
                label:
                  group.variants.length > 1
                    ? `${group.displayName} · ${group.variants
                        .filter((variant) => variant !== 'mặc định')
                        .join('/')}`
                    : group.displayName,
                description: providerName(group.providerId),
              }))}
              onValueChange={(value) => void setDefault(value)}
              className="w-[240px]"
            />
          ) : null}
        </div>
      </section>

      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {providers.map((provider) => (
          <ProviderRow key={provider.id} provider={provider} />
        ))}
        <li className="list-none">
          <AddProvider />
        </li>
      </ul>

      <section className="flex flex-col gap-2.5 border-t border-[var(--border)] pt-3">
        <div className="flex flex-col gap-0.5">
          <h3 className="m-0 text-[12px] font-medium leading-[18px] text-[var(--text-muted)]">
            Model đã cấu hình
          </h3>
          <p className="m-0 text-[12px] leading-[18px] text-[var(--text-faint)]">
            {modelGroups.length} model · {models.length} biến thể
          </p>
        </div>

        {modelGroups.length === 0 ? (
          <p className="m-0 rounded-[var(--radius)] border border-dashed border-[var(--border-strong)] px-3 py-3 text-center text-[12px] leading-[18px] text-[var(--text-faint)]">
            Chưa có model nào. Thêm nhà cung cấp rồi bấm “Model” để phát hiện.
          </p>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {modelGroups.map((group) => (
              <li
                key={group.key}
                className={cn(
                  'flex items-center gap-2 rounded-[var(--radius)] border px-2 py-1.5 transition-colors',
                  group.isDefault
                    ? 'border-[var(--border-strong)] bg-[var(--bg-surface)]'
                    : 'border-[var(--border)] hover:bg-[var(--bg-hover)]',
                )}
              >
                <button
                  type="button"
                  aria-label={
                    group.isDefault ? 'Model mặc định' : `Đặt ${group.displayName} làm mặc định`
                  }
                  onClick={() => void setDefault(group.ids[0] ?? '')}
                  className={cn(
                    'inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-[var(--radius-sm)] transition-colors hover:bg-[var(--bg-active)]',
                    group.isDefault
                      ? 'text-[var(--warning)]'
                      : 'text-[var(--text-faint)] hover:text-[var(--text)]',
                  )}
                >
                  <Star size={12} className={group.isDefault ? 'fill-current' : undefined} />
                </button>
                <span className="min-w-0 flex-1 truncate text-[13px] text-[var(--text)]">
                  {group.displayName}
                </span>
                <span className="hidden min-w-0 shrink-0 truncate font-mono text-[11.5px] text-[var(--text-faint)] sm:block">
                  {providerName(group.providerId)}
                </span>
                <span className="flex shrink-0 items-center gap-1">
                  {group.variants
                    .filter((variant) => variant !== 'mặc định')
                    .map((variant) => (
                      <Badge key={variant}>{variant}</Badge>
                    ))}
                  <span className="font-mono text-[11px] tabular-nums text-[var(--text-faint)]">
                    {Math.round(group.contextWindow / 1024)}k
                  </span>
                </span>
                <IconButton
                  label={`Xoá ${group.displayName}`}
                  className="h-6 w-6 hover:text-[var(--danger)]"
                  onClick={() => void removeModels(group.ids)}
                >
                  <Trash2 size={12} />
                </IconButton>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
