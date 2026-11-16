import type { AgentMode, CustomCommand } from '@nexus/shared'
import { parseArgsStringToArgv } from 'string-argv'

// Slash command set mirrors opencode: built-ins run app actions, anything else falls back
// to a template in .nexus/commands (or .claude/commands) and finally to a plain prompt.
export interface SlashCommand {
  name: string
  description: string
  category: string
  args?: boolean
}

export const AGENT_MODES: AgentMode[] = ['agent', 'plan', 'ask', 'code', 'review', 'debug']

export const BUILTIN_COMMANDS: SlashCommand[] = [
  { name: 'new', description: 'Tạo phiên mới', category: 'Phiên' },
  {
    name: 'undo',
    description: 'Hoàn nguyên lượt trước, đưa lại prompt vào ô nhập',
    category: 'Phiên',
  },
  { name: 'fork', description: 'Nhân bản phiên hiện tại', category: 'Phiên' },
  {
    name: 'compact',
    description: 'Tóm tắt hội thoại để giảm context',
    category: 'Phiên',
    args: true,
  },
  { name: 'export', description: 'Sao chép hội thoại dạng Markdown', category: 'Phiên' },
  { name: 'model', description: 'Chọn model: /model <tên>', category: 'Model', args: true },
  {
    name: 'agent',
    description: 'Đổi chế độ agent: /agent <chế độ>',
    category: 'Model',
    args: true,
  },
  {
    name: 'init',
    description: 'Khảo sát repo và tạo/cập nhật AGENTS.md',
    category: 'Code',
  },
  { name: 'redo', description: 'Gửi lại lượt vừa hoàn nguyên', category: 'Code' },
  {
    name: 'plan',
    description: 'Lập kế hoạch trước khi sửa code: /plan <việc>',
    category: 'Code',
    args: true,
  },
  { name: 'review', description: 'Review thay đổi chưa commit', category: 'Code' },
  {
    name: 'fix',
    description: 'Sửa lỗi: /fix <mô tả hoặc lỗi>',
    category: 'Code',
    args: true,
  },
  {
    name: 'test',
    description: 'Chạy test và sửa lỗi: /test [phạm vi]',
    category: 'Code',
    args: true,
  },
  {
    name: 'commit',
    description: 'Stage và commit: /commit <message>',
    category: 'Git',
    args: true,
  },
  { name: 'diff', description: 'Sao chép git diff chưa commit', category: 'Git' },
  { name: 'status', description: 'Nhánh và tệp đã thay đổi', category: 'Git' },
  { name: 'stop', description: 'Dừng tác vụ đang chạy', category: 'Tác vụ' },
  { name: 'pause', description: 'Dừng sau khi hết lượt hiện tại', category: 'Tác vụ' },
  { name: 'approve', description: 'Cho phép yêu cầu đang chờ', category: 'Tác vụ' },
  { name: 'deny', description: 'Từ chối yêu cầu đang chờ', category: 'Tác vụ' },
  {
    name: 'goal',
    description: 'Đặt/xem mục tiêu dài hạn của phiên: /goal <mục tiêu> | done | clear',
    category: 'Phiên',
    args: true,
  },
  {
    name: 'sandbox',
    description: 'Xem ma trận quyền của sandbox: /sandbox [chế độ]',
    category: 'Cấu hình',
    args: true,
  },
  {
    name: 'permissions',
    description: 'Xem/đổi quyền: /permissions <read-only|workspace-write|…>',
    category: 'Cấu hình',
    args: true,
  },
  { name: 'tools', description: 'Liệt kê tool agent có thể dùng', category: 'Code' },
  {
    name: 'grep',
    description: 'Tìm trong mã nguồn dự án: /grep <mẫu>',
    category: 'Code',
    args: true,
  },
  {
    name: 'open',
    description: 'Mở thư mục chứa tệp trong file manager: /open <đường dẫn>',
    category: 'Code',
    args: true,
  },
  { name: 'tasks', description: 'Tác vụ gần đây của phiên', category: 'Tác vụ' },
  { name: 'usage', description: 'Token và chi phí ước tính theo ngày', category: 'Tác vụ' },
  { name: 'logs', description: 'Log gần nhất của ứng dụng', category: 'View' },
  { name: 'archive', description: 'Lưu trữ phiên hiện tại', category: 'Phiên' },
  { name: 'pin', description: 'Ghim/bỏ ghim phiên hiện tại', category: 'Phiên' },
  {
    name: 'find',
    description: 'Tìm trong phiên, dự án, tệp: /find <từ khoá>',
    category: 'Code',
    args: true,
  },
  { name: 'log', description: 'Commit gần đây: /log [số]', category: 'Git', args: true },
  {
    name: 'rename',
    description: 'Đổi tên phiên: /rename <tên mới>',
    category: 'Phiên',
    args: true,
  },
  { name: 'stats', description: 'Token và thời gian của phiên', category: 'Tác vụ' },
  { name: 'sync', description: 'Fetch rồi pull nhánh hiện tại', category: 'Git' },
  { name: 'push', description: 'Đẩy nhánh hiện tại lên remote', category: 'Git' },
  {
    name: 'discard',
    description: 'Bỏ thay đổi của tệp: /discard <đường dẫn…>',
    category: 'Git',
    args: true,
  },
  {
    name: 'branch',
    description: 'Xem/đổi nhánh: /branch [tên]',
    category: 'Git',
    args: true,
  },
  { name: 'resume', description: 'Tiếp tục tác vụ bị gián đoạn', category: 'Tác vụ' },
  { name: 'context', description: 'Xem mức dùng context của tác vụ', category: 'Tác vụ' },
  { name: 'help', description: 'Liệt kê mọi lệnh', category: 'View' },
  { name: 'connect', description: 'Mở cài đặt provider và model', category: 'Provider' },
  { name: 'mcp', description: 'Quản lý server MCP (connector)', category: 'Provider' },
  { name: 'reload', description: 'Nạp lại lệnh, model, provider', category: 'View' },
  {
    name: 'approvals',
    description: 'Xem/đổi quyền phê duyệt (alias Codex)',
    category: 'Cấu hình',
    args: true,
  },
  { name: 'agents', description: 'Liệt kê agent mode khả dụng', category: 'Cấu hình' },
  { name: 'commands', description: 'Liệt kê lệnh riêng trong dự án', category: 'View' },
  {
    name: 'effort',
    description: 'Xem/đổi reasoning effort: /effort <mức>',
    category: 'Model',
    args: true,
  },
  { name: 'theme', description: 'Đổi giao diện sáng/tối', category: 'View' },
  { name: 'quit', description: 'Đóng ứng dụng', category: 'View' },
]

export function parseSlash(text: string): { name: string; input: string } | null {
  if (!text.startsWith('/')) return null
  const separator = text.search(/\s/)
  const name = text.slice(1, separator === -1 ? undefined : separator).toLowerCase()
  return { name, input: separator === -1 ? '' : text.slice(separator).trim() }
}

// Tách tham số theo quy ước shell: "..." và '...' giữ nguyên khoảng trắng bên trong.
export function parseArgs(input: string): string[] {
  return parseArgsStringToArgv(input)
}

function fromCustom(custom: CustomCommand): SlashCommand {
  return { name: custom.name, description: custom.description, category: 'Lệnh riêng', args: true }
}

export function listCommands(custom: CustomCommand[], query: string): SlashCommand[] {
  const all = [...BUILTIN_COMMANDS, ...custom.map(fromCustom)]
  const needle = query.trim().toLowerCase()
  if (!needle) return all
  // Xếp hạng: trùng tên > khớp đầu tên > khớp mô tả; cùng hạng thì tên ngắn hơn trước.
  return all
    .map((command) => {
      const name = command.name.toLowerCase()
      const score =
        name === needle
          ? 0
          : name.startsWith(needle)
            ? 1
            : command.description.toLowerCase().includes(needle)
              ? 2
              : -1
      return { command, score }
    })
    .filter((entry) => entry.score >= 0)
    .sort(
      (a, b) =>
        a.score - b.score ||
        a.command.name.length - b.command.name.length ||
        a.command.name.localeCompare(b.command.name),
    )
    .map((entry) => entry.command)
}

// ponytail: chỉ hỗ trợ $ARGUMENTS như opencode; thêm !`bash` và @file khi cần.
export function expandTemplate(template: string, input: string): string {
  if (template.includes('$ARGUMENTS')) return template.replaceAll('$ARGUMENTS', input).trim()
  return input ? `${template.trim()}\n\n${input}` : template.trim()
}
