import { resolve as resolvePath } from 'node:path'

import type { DomainContext, DomainModule, ProjectInput, ProjectResult } from './types.ts'

const NAME = /^[a-zA-Z0-9_-]{1,60}$/

/** Tạo project trong thư mục do Core cung cấp; không nhận path tuỳ ý từ renderer. */
export class ProjectManager {
  create(domain: DomainModule, context: DomainContext, input: ProjectInput): ProjectResult {
    const name = input.name ?? `${domain.id}-project`
    if (!NAME.test(name)) return { ok: false, path: '', files: [], error: 'Invalid project name' }
    const root =
      typeof context.settings['projectsRoot'] === 'string' ? context.settings['projectsRoot'] : ''
    if (root === '') return { ok: false, path: '', files: [], error: 'No projects root configured' }
    const base = resolvePath(root)
    const target = resolvePath(base, name)
    if (target !== base && !target.startsWith(`${base}/`)) {
      return { ok: false, path: '', files: [], error: 'Project path escapes projects root' }
    }
    return domain.createProject(context, { ...input, name, root: target })
  }
}
