import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs'

import { NexusError } from './errors.ts'
import { base64Decode, base64Encode, ensureDirectory, pathJoin, utf8Suffix } from './util.ts'

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
    if (!this.ensureKey() || !this.key) throw new NexusError('E_CONFIG', 'Secret store is unavailable')
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', this.key, iv)
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
    const tag = cipher.getAuthTag()
    return base64Encode(Buffer.concat([iv, tag, ciphertext]))
  }

  decrypt(ciphertext: string): string {
    if (!this.ensureKey() || !this.key) throw new NexusError('E_CONFIG', 'Secret store is unavailable')
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

  static mask(apiKey: string): string {
    if (apiKey.length <= 8) return apiKey.length === 0 ? '' : '****'
    return `${apiKey.slice(0, 4)}…${utf8Suffix(apiKey, 4)}`
  }

  private ensureKey(): boolean {
    if (this.key && this.key.length === 32) return true
    const path = pathJoin(this.userDataDir, 'secrets.key')
    try {
      if (existsSync(path)) {
        const existing = readFileSync(path)
        if (existing.length === 32) {
          this.key = existing
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
