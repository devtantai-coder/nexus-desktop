/** Lỗi nghiệp vụ: `code` là mã ổn định cho UI/agent xử lý, `message` đã được lọc secret. */
import { redactSecrets } from './security.ts'

export class NexusError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(redactSecrets(message))
    this.name = 'NexusError'
    this.code = code
  }
}

export function errorCode(error: unknown): string {
  if (error instanceof NexusError) return error.code
  return 'E_INTERNAL'
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
