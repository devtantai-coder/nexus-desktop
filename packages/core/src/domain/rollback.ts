/** Suy rollback từ installCommand đã khai báo. Không suy ra thì null — không đoán. */

const PACKAGE = /^[a-z0-9][a-z0-9_.+/-]*$/i
const MANAGERS = /^(?:apt|apt-get|dnf|yum|pacman|brew|zypper|cargo|npm|pip|python|python3|uv)$/

/** Chỉ nhận lệnh install một package, không ghép lệnh; flag bị bỏ qua, không bị nhầm là tên package. */
function parseSingleInstall(command: string): { manager: string; pkg: string } | null {
  if (/[;&|`]/.test(command)) return null
  const tokens = command.trim().split(/\s+/)
  const head = tokens[0] ?? ''
  if (!MANAGERS.test(head)) return null

  let index = 1
  let manager = head
  if ((head === 'python' || head === 'python3') && tokens[1] === '-m' && tokens[2] === 'pip') {
    manager = 'python-pip'
    index = 3
  } else if (head === 'pip') {
    manager = 'python-pip'
  } else if (head === 'uv' && tokens[1] === 'pip') {
    manager = 'uv'
    index = 2
  }

  const verb = tokens[index] ?? ''
  if (manager === 'pacman') {
    if (verb !== '-S') return null
    index += 1
  } else {
    if (verb !== 'install') return null
    index += 1
  }

  const packages: string[] = []
  for (; index < tokens.length; index += 1) {
    const token = tokens[index] ?? ''
    if (token.startsWith('-')) continue // -y, --user, --noconfirm, -e...
    if (!PACKAGE.test(token)) return null // ".", "..", URL, shell meta...
    packages.push(token)
  }
  if (packages.length !== 1) return null
  return { manager, pkg: packages[0] ?? '' }
}

export function deriveRollbackCommand(installCommand: string | null): string | null {
  if (installCommand === null) return null
  const parsed = parseSingleInstall(installCommand.trim())
  if (parsed === null) return null
  const { manager, pkg } = parsed
  switch (manager) {
    case 'apt':
    case 'apt-get':
      return `apt-get remove -y ${pkg}`
    case 'python-pip':
      return `python3 -m pip uninstall -y ${pkg}`
    case 'uv':
      return `uv pip uninstall ${pkg}`
    case 'cargo':
      return `cargo uninstall ${pkg}`
    case 'dnf':
    case 'yum':
      return `dnf remove -y ${pkg}`
    case 'pacman':
      return `pacman -R ${pkg}`
    case 'brew':
      return `brew uninstall ${pkg}`
    case 'zypper':
      return `zypper remove -y ${pkg}`
    case 'npm':
      return `npm uninstall -g ${pkg}`
    default:
      return null
  }
}
