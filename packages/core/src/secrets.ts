import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs'

import { NexusError } from './errors.ts'
import { base64Decode, base64Encode, ensureDirectory, pathJoin } from './util.ts'

/** Khoá AES-256-GCM cục bộ tại `<userData>/secrets.key` (0600), giống bản C++. */
export class SecretStore {
  private readonly userDataDir: string
  private key?: Buffer

  constructor(userDataDir: string) {
    this.userDataDir = userDataDir
    this.ensureKey()
  }

  available(): boolean {
    return this.ensureKey()
  }

  encrypt(plaintext: string): string {
    if (!this.ensureKey() || !this.key)
      throw new NexusError('E_CONFIG', 'Secret store is unavailable')
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', this.key, iv)
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
    const tag = cipher.getAuthTag()
    return base64Encode(Buffer.concat([iv, tag, ciphertext]))
  }

  decrypt(ciphertext: string): string {
    if (!this.ensureKey() || !this.key)
      throw new NexusError('E_CONFIG', 'Secret store is unavailable')
    const payload = Buffer.from(base64Decode(ciphertext), 'binary')
    if (payload.length < 28) throw new NexusError('E_AUTH', 'Invalid encrypted secret')
    const iv = payload.subarray(0, 12)
    const tag = payload.subarray(12, 28)
    const body = payload.subarray(28)
    const decipher = createDecipheriv('aes-256-gcm', this.key, iv)
    decipher.setAuthTag(tag)
    try {
      return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8')
    } catch {
      throw new NexusError('E_AUTH', 'Cannot decrypt secret (key changed or data corrupted)')
    }
  }

  /** Gợi ý hiển thị: chỉ lộ prefix nhận dạng loại khoá, không lộ đầu/cuối giá trị thật. */
  static mask(apiKey: string): string {
    if (apiKey === '') return ''
    const prefix = /^(?:sk-ant-|sk-|ghp_|gho_|github_pat_|glpat-|xox[baprs]-|AIza)/i.exec(
      apiKey,
    )?.[0]
    if (prefix === undefined) return '****'
    const rest = apiKey.slice(prefix.length)
    return `${prefix}${'*'.repeat(Math.min(4, rest.length))}`
  }

  private ensureKey(): boolean {
    if (this.key && this.key.length === 32) return true
    const path = pathJoin(this.userDataDir, 'secrets.key')
    try {
      if (existsSync(path)) {
        const existing = readFileSync(path)
        if (existing.length === 32) {
          this.key = existing
          // Khoá có sẵn cũng phải 0600: file world-readable từ lần cài trước không được giữ nguyên.
          try {
            chmodSync(path, 0o600)
          } catch {
            // ignore (fs không hỗ trợ mode)
          }
          return true
        }
      }
      ensureDirectory(this.userDataDir)
      this.key = randomBytes(32)
      writeFileSync(path, this.key, { mode: 0o600 })
      try {
        chmodSync(path, 0o600)
      } catch {
        // ignore (fs không hỗ trợ mode)
      }
      return true
    } catch {
      return false
    }
  }
}
