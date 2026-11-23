export function shortModelName(name: string): string {
  const trimmed = name.trim()
  const slash = trimmed.lastIndexOf('/')
  return slash === -1 ? trimmed : trimmed.slice(slash + 1)
}
