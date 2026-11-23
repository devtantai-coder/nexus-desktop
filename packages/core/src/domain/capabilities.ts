/**
 * Capability metadata cho builtin tools + affinity theo domain.
 * Dùng để re-rank (KHÔNG pruning) tool trước khi cắt budget — tool ngoài domain vẫn dùng được,
 * chỉ ưu tiên đưa tool hợp domain vào budget.
 */

export const TOOL_CAPABILITIES: Record<string, readonly string[]> = {
  read_file: ['file-io', 'analysis'],
  read_multiple_files: ['file-io', 'analysis'],
  write_file: ['file-io', 'patch'],
  edit_file: ['file-io', 'patch'],
  apply_patch: ['file-io', 'patch'],
  copy_file: ['file-io'],
  create_directory: ['file-io'],
  delete_file: ['file-io'],
  list_directory: ['file-io', 'analysis'],
  list_files: ['file-io', 'analysis'],
  get_file_info: ['file-io', 'analysis'],
  repo_map: ['analysis'],
  code_tree: ['analysis'],
  search_code: ['analysis'],
  search_files: ['analysis'],
  symbol_search: ['analysis'],
  find_references: ['analysis'],
  analyze_errors: ['analysis'],
  inspect_package: ['analysis'],
  verify_changes: ['analysis', 'test'],
  execute_command: ['shell', 'terminal'],
  start_process: ['shell', 'terminal'],
  stop_process: ['shell', 'terminal'],
  get_process_output: ['shell', 'terminal'],
  run_build: ['build', 'shell'],
  run_tests: ['test', 'shell'],
  install_dependencies: ['build', 'shell'],
  git_status: ['git', 'analysis'],
  git_diff: ['git', 'analysis'],
  git_log: ['git', 'analysis'],
  git_branch: ['git'],
  git_checkout: ['git'],
  git_commit: ['git'],
  save_memory: ['memory'],
  search_memory: ['memory'],
  delete_memory: ['memory'],
  memory_file_read: ['memory'],
  memory_file_write: ['memory'],
  web_search: ['web'],
  web_fetch: ['web'],
  browser_open: ['browser', 'web'],
  delegate_task: ['delegate'],
  delegate_parallel: ['delegate'],
  subagent: ['delegate'],
  agent_terminal_read: ['delegate', 'terminal'],
  agent_terminal_write: ['delegate', 'terminal'],
  mcp_call: ['mcp'],
  mcp_list_servers: ['mcp'],
  mcp_list_tools: ['mcp'],
  create_skill: ['memory'],
  update_skill: ['memory'],
  delete_skill: ['memory'],
  list_skills: ['memory'],
  load_skill: ['memory'],
}

export const DOMAIN_CAPABILITY_AFFINITY: Record<string, readonly string[]> = {
  web: ['file-io', 'patch', 'shell', 'build', 'test', 'git', 'web'],
  systems: ['shell', 'build', 'test', 'analysis', 'git', 'terminal'],
  aiml: ['shell', 'test', 'analysis', 'delegate', 'web'],
  embedded: ['shell', 'build', 'analysis', 'terminal'],
  database: ['shell', 'analysis', 'file-io'],
  devops: ['shell', 'build', 'git', 'mcp', 'web'],
  security: ['shell', 'analysis', 'web', 'git'],
  game: ['file-io', 'patch', 'shell', 'analysis', 'web'],
  mobile: ['shell', 'build', 'analysis', 'terminal'],
  desktop: ['shell', 'build', 'analysis', 'terminal'],
}

/** Ổn định, không xoá tool: đưa tool hợp domain lên đầu, giữ nguyên thứ tự còn lại. */
export function boostDomainTools<T extends { name: string }>(
  entries: T[],
  domainId: string | null,
  affinity: Record<string, readonly string[]> = DOMAIN_CAPABILITY_AFFINITY,
  capabilities: Record<string, readonly string[]> = TOOL_CAPABILITIES,
): T[] {
  if (domainId === null) return entries
  // Object.hasOwn: id/tool tên trùng prototype (constructor, __proto__...) không được boost.
  const boost = new Set(Object.hasOwn(affinity, domainId) ? (affinity[domainId] ?? []) : [])
  if (boost.size === 0) return entries
  const yes: T[] = []
  const no: T[] = []
  for (const entry of entries) {
    const caps = Object.hasOwn(capabilities, entry.name) ? (capabilities[entry.name] ?? []) : []
    if (caps.some((cap) => boost.has(cap))) yes.push(entry)
    else no.push(entry)
  }
  return [...yes, ...no]
}
