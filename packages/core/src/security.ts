/** Bộ lọc an toàn của agent (port security.cpp). */

export type Risk = 'read' | 'write' | 'exec' | 'network' | 'destructive'
export type Decision = 'allow' | 'ask' | 'deny'

export const riskName = (risk: Risk): string => risk
export const parseRisk = (value: string): Risk =>
  value === 'write' || value === 'exec' || value === 'network' || value === 'destructive'
    ? value
    : 'read'

const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/sk-[A-Za-z0-9_-]{10,}/g, '***redacted***'],
  [/(Bearer\s+)[A-Za-z0-9._-]{10,}/gi, '$1***redacted***'],
  [/(api[_-]?key["'\s:=]+)[A-Za-z0-9._-]{8,}/gi, '$1***redacted***'],
  [/(x-api-key["'\s:=]+)[A-Za-z0-9._-]{8,}/gi, '$1***redacted***'],
]

export function redactSecrets(value: string): string {
  let out = value
  for (const [pattern, replacement] of SECRET_PATTERNS) {
    out = out.replace(pattern, replacement)
  }
  return out
}

const DANGEROUS_COMMANDS: Array<[RegExp, string]> = [
  [/\brm\s+(-[a-zA-Z]*\s+)*-[a-zA-Z]*[rf][a-zA-Z]*\s+(\/|~|\$HOME)(\s|$)/, 'recursive delete of a root or home directory'],
  [/\brm\s+-rf\s+(\*|\.\s*$)/, 'recursive delete of the current directory'],
  [/\bmkfs(\.\w+)?\b/, 'filesystem format'],
  [/\bdd\b[^\n]*\bof=\/dev\//, 'raw device write'],
  [/>\s*\/dev\/(sd|nvme|disk)/, 'raw device write'],
  [/:\(\)\s*\{\s*:\|:&\s*\}\s*;/, 'fork bomb'],
  [/\bchmod\s+-R\s+777\s+\/(\s|$)/, 'permission change on root'],
  [/\b(shutdown|reboot|halt|poweroff)\b/, 'host power operation'],
  [/\bgit\s+push\b[^\n]*(--force|-f)\b/, 'force push'],
  [/\bgit\s+reset\s+--hard\b/, 'hard reset (discards local changes)'],
  [/\bgit\s+clean\s+-[a-zA-Z]*f/, 'removes untracked files'],
  [/\b(curl|wget)\b[^\n]*\|\s*(sudo\s+)?(ba)?sh\b/, 'piping remote content into a shell'],
  [/\bsudo\b/, 'privilege escalation'],
  [/\bnpm\s+publish\b|\byarn\s+publish\b|\bpnpm\s+publish\b/, 'package publish'],
  [/\bhistory\s+-c\b/, 'destroys shell history'],
]

export function dangerousCommand(command: string): { dangerous: boolean; reason: string } {
  for (const [pattern, reason] of DANGEROUS_COMMANDS) {
    if (pattern.test(command)) return { dangerous: true, reason }
  }
  return { dangerous: false, reason: '' }
}

export interface PermissionVerdict {
  decision: Decision
  reason: string
}

export function decidePermission(
  permissionMode: string,
  risk: Risk,
  outsideWorkspace: boolean,
  command: string,
): PermissionVerdict {
  if (permissionMode === 'unrestricted') {
    return { decision: 'allow', reason: 'unrestricted: full access' }
  }
  const label = permissionMode
  if (risk === 'destructive') {
    if (permissionMode === 'terminal-approval' || permissionMode === 'elevated') {
      return { decision: 'ask', reason: `${label}: destructive operation requires confirmation` }
    }
    return { decision: 'deny', reason: `${label}: destructive operations are not permitted` }
  }
  if (outsideWorkspace) {
    if (permissionMode === 'elevated' || permissionMode === 'terminal-approval') {
      return { decision: 'ask', reason: `${label}: target is outside the workspace` }
    }
    return { decision: 'deny', reason: `${label}: target is outside the workspace` }
  }
  if (command !== '') {
    const { dangerous, reason } = dangerousCommand(command)
    if (dangerous) {
      if (permissionMode === 'read-only' || permissionMode === 'workspace-write') {
        return { decision: 'deny', reason: `${label}: blocked command (${reason})` }
      }
      return { decision: 'ask', reason: `${label}: dangerous command (${reason})` }
    }
  }
  if (risk === 'read') return { decision: 'allow', reason: `${label}: read access` }
  if (risk === 'write') {
    if (permissionMode === 'read-only') {
      return { decision: 'deny', reason: `${label}: write access denied` }
    }
    return { decision: 'allow', reason: `${label}: workspace write` }
  }
  if (risk === 'exec' || risk === 'network') {
    return { decision: 'ask', reason: `${label}: execution requires approval` }
  }
  return { decision: 'deny', reason: `${label}: unknown risk` }
}
