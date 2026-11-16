export function stripInternalBlocks(content: string): string {
  return content
    .replace(/```nexus-plan[\s\S]*?(?:```|$)/gi, '')
    .replace(/```nexus-tool[\s\S]*?(?:```|$)/gi, '')
    .replace(/\bNEXUS_DONE\b/g, '')
    .replace(/^\s+/, '')
}
