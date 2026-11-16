export const MODEL_VARIANT_SEPARATOR = ':'

const VARIANT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

export interface ModelVariantParts {
  modelId: string
  baseModelId: string
  variant: string
}

export const normalizeVariant = (value: string): string =>
  value.trim().replace(/\s+/g, ' ').slice(0, 80)

export const splitModelVariant = (raw: string): ModelVariantParts => {
  const modelId = raw.trim()
  const index = modelId.lastIndexOf(MODEL_VARIANT_SEPARATOR)
  const candidate = index > 0 ? modelId.slice(index + 1) : ''
  if (candidate === '' || !VARIANT_PATTERN.test(candidate)) {
    return { modelId, baseModelId: modelId, variant: '' }
  }
  return {
    modelId,
    baseModelId: modelId.slice(0, index),
    variant: candidate,
  }
}

export const joinModelVariant = (baseModelId: string, variant: string): string => {
  const base = baseModelId.trim()
  const label = normalizeVariant(variant)
  return label === '' ? base : `${base}${MODEL_VARIANT_SEPARATOR}${label}`
}

export const modelVariantLabel = (model: { modelId: string; variant?: string }): string => {
  const stored = normalizeVariant(model.variant ?? '')
  return stored !== '' ? stored : splitModelVariant(model.modelId).variant
}
