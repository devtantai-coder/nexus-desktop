export interface DiffLine {
  kind: 'context' | 'add' | 'del'
  text: string
}

const MAX_LINES = 1200

export function diffLines(before = '', after = ''): DiffLine[] {
  const a = before.split('\n').slice(0, MAX_LINES)
  const b = after.split('\n').slice(0, MAX_LINES)
  const rows = a.length
  const cols = b.length
  const table: number[][] = Array.from({ length: rows + 1 }, () =>
    new Array<number>(cols + 1).fill(0),
  )
  for (let i = rows - 1; i >= 0; i -= 1) {
    const row = table[i] as number[]
    const next = table[i + 1] as number[]
    for (let j = cols - 1; j >= 0; j -= 1) {
      row[j] =
        a[i] === b[j]
          ? (next[j + 1] as number) + 1
          : Math.max(next[j] as number, row[j + 1] as number)
    }
  }
  const out: DiffLine[] = []
  let i = 0
  let j = 0
  while (i < rows && j < cols) {
    if (a[i] === b[j]) {
      out.push({ kind: 'context', text: a[i] as string })
      i += 1
      j += 1
    } else if (
      ((table[i + 1] as number[])[j] as number) >= ((table[i] as number[])[j + 1] as number)
    ) {
      out.push({ kind: 'del', text: a[i] as string })
      i += 1
    } else {
      out.push({ kind: 'add', text: b[j] as string })
      j += 1
    }
  }
  while (i < rows) {
    out.push({ kind: 'del', text: a[i] as string })
    i += 1
  }
  while (j < cols) {
    out.push({ kind: 'add', text: b[j] as string })
    j += 1
  }
  return out.filter((line, index) => {
    if (line.kind !== 'context') return true
    return out.slice(Math.max(0, index - 2), index + 3).some((peer) => peer.kind !== 'context')
  })
}
