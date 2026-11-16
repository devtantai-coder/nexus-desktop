import { trim, uuid } from './util.ts'

export type Json = any

/** Bóc khối ```nexus-plan ... ``` đầu tiên có JSON hợp lệ thành plan có cấu trúc. */
export const extractPlan = (text: string, fallbackTitle: string): Json => {
  const fence = /```nexus-plan\s*([\s\S]*?)```/g
  let parsedBlock: Json = null
  let match = fence.exec(text)
  while (match !== null) {
    let parsed: Json
    try {
      parsed = JSON.parse(match[1] as string)
    } catch {
      parsed = null
    }
    if (parsed !== null) {
      parsedBlock = parsed
      break
    }
    match = fence.exec(text)
  }
  if (parsedBlock === null) return null

  let rawSteps: Json = []
  let title = fallbackTitle
  if (Array.isArray(parsedBlock)) {
    rawSteps = parsedBlock
  } else if (parsedBlock !== null && typeof parsedBlock === 'object') {
    title = typeof parsedBlock['title'] === 'string' ? parsedBlock['title'] : fallbackTitle
    rawSteps = Array.isArray(parsedBlock['steps']) ? parsedBlock['steps'] : []
  }
  if (!Array.isArray(rawSteps) || rawSteps.length === 0) return null
  const steps: Json[] = []
  for (const raw of rawSteps as Json[]) {
    if (steps.length >= 12) break
    let stepTitle = ''
    let description = ''
    if (typeof raw === 'string') {
      stepTitle = trim(raw)
    } else if (raw !== null && typeof raw === 'object') {
      stepTitle = trim(
        typeof raw['title'] === 'string'
          ? raw['title']
          : typeof raw['name'] === 'string'
            ? raw['name']
            : '',
      )
      description = typeof raw['description'] === 'string' ? raw['description'] : ''
    }
    if (stepTitle === '') continue
    const step: Json = { id: `step-${uuid()}`, title: stepTitle, state: 'pending' }
    if (description !== '') step['description'] = description
    steps.push(step)
  }
  if (steps.length === 0) return null
  return { title: trim(title) === '' ? fallbackTitle : trim(title), steps }
}

export const stripPlanFence = (text: string): string =>
  trim(text.replace(/```nexus-plan\s*[\s\S]*?```/g, ''))
