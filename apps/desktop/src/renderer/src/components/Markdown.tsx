import type React from 'react'
import { memo, useCallback, useRef, useState } from 'react'
import { Check, Copy, ExternalLink } from 'lucide-react'
import { IconButton } from './ui'
import { api } from '../kernel'

/**
 * Markdown tối giản: chỉ những gì chat cần (heading, đoạn, list, quote, hr, bảng, code fence, inline).
 * Không thư viện, không dangerouslySetInnerHTML → mọi HTML trong câu trả lời của model đều bị escape.
 */

const INLINE_RE =
  /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(__[^_\n]+__)|(\*[^*\n]+\*)|(_[^_\n]+_)|(~~[^~\n]+~~)|(\[[^\]\n]*\]\([^)\s]+\))/g

function renderInline(text: string, key: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = []
  let index = 0
  for (const match of text.matchAll(INLINE_RE)) {
    const start = match.index ?? 0
    if (start > index) nodes.push(text.slice(index, start))
    const token = match[0]
    const id = `${key}-${start}`
    if (token.startsWith('`')) {
      nodes.push(<code key={id}>{token.slice(1, -1)}</code>)
    } else if (token.startsWith('**') || token.startsWith('__')) {
      nodes.push(<strong key={id}>{token.slice(2, -2)}</strong>)
    } else if (token.startsWith('~~')) {
      nodes.push(<del key={id}>{token.slice(2, -2)}</del>)
    } else if (token.startsWith('[')) {
      const split = token.indexOf('](')
      const label = token.slice(1, split)
      const href = token.slice(split + 2, -1)
      const external = /^https?:\/\//i.test(href)
      nodes.push(
        <a
          key={id}
          href={external ? href : undefined}
          onClick={(event) => {
            event.preventDefault()
            if (external) void api.app.openExternal(href)
          }}
        >
          {label}
          {external ? (
            <ExternalLink size={10} className="ml-1 inline align-baseline opacity-60" />
          ) : null}
        </a>,
      )
    } else {
      nodes.push(<em key={id}>{token.slice(1, -1)}</em>)
    }
    index = start + token.length
  }
  if (index < text.length) nodes.push(text.slice(index))
  return nodes
}

function CodeBlock({ code, language }: { code: string; language: string }): React.JSX.Element {
  const ref = useRef<HTMLPreElement>(null)
  const [copied, setCopied] = useState(false)
  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(ref.current?.textContent ?? '')
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* clipboard unavailable */
    }
  }, [])
  return (
    <div className="code-shell group relative overflow-hidden rounded-[var(--radius-lg)] border border-[var(--border-code)] bg-[var(--bg-code)] text-[var(--text-code)]">
      {language ? (
        <div className="border-b border-[var(--border-code)] bg-[var(--bg-code-head)] px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.08em] text-[var(--text-faint)]">
          {language}
        </div>
      ) : null}
      <pre ref={ref}>{code}</pre>
      <div className="absolute right-1.5 top-1.5 opacity-0 transition-opacity group-hover:opacity-100">
        <IconButton label={copied ? 'Đã sao chép' : 'Sao chép'} onClick={() => void copy()}>
          {copied ? <Check size={13} /> : <Copy size={13} />}
        </IconButton>
      </div>
    </div>
  )
}

const cells = (line: string): string[] =>
  line
    .replace(/^\s*\|/, '')
    .replace(/\|\s*$/, '')
    .split('|')
    .map((cell) => cell.trim())

const isDivider = (line: string): boolean =>
  /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(line) && line.includes('-')

function parseBlocks(source: string): React.ReactNode[] {
  const lines = source.replace(/\r\n/g, '\n').split('\n')
  const blocks: React.ReactNode[] = []
  let index = 0

  while (index < lines.length) {
    const line = lines[index] as string
    if (!line.trim()) {
      index += 1
      continue
    }

    const fence = /^\s*```(\S*)\s*$/.exec(line)
    if (fence) {
      const language = fence[1] ?? ''
      const body: string[] = []
      index += 1
      while (index < lines.length && !/^\s*```\s*$/.test(lines[index] as string)) {
        body.push(lines[index] as string)
        index += 1
      }
      index += 1
      blocks.push(<CodeBlock key={`fence-${index}`} code={body.join('\n')} language={language} />)
      continue
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line)
    if (heading) {
      const level = heading[1]?.length ?? 1
      const Tag = `h${Math.min(level + 0, 6)}` as 'h1'
      blocks.push(<Tag key={`h-${index}`}>{renderInline(heading[2] ?? '', `h${index}`)}</Tag>)
      index += 1
      continue
    }

    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      blocks.push(<hr key={`hr-${index}`} />)
      index += 1
      continue
    }

    if (
      /^\s*\|.*\|\s*$/.test(line) &&
      index + 1 < lines.length &&
      isDivider(lines[index + 1] as string)
    ) {
      const header = cells(line)
      index += 2
      const rows: string[][] = []
      while (index < lines.length && /^\s*\|.*\|\s*$/.test(lines[index] as string)) {
        rows.push(cells(lines[index] as string))
        index += 1
      }
      blocks.push(
        <table key={`table-${index}`}>
          <thead>
            <tr>
              {header.map((cell, cellIndex) => (
                <th key={cellIndex}>{renderInline(cell, `th${index}-${cellIndex}`)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {row.map((cell, cellIndex) => (
                  <td key={cellIndex}>
                    {renderInline(cell, `td${index}-${rowIndex}-${cellIndex}`)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>,
      )
      continue
    }

    if (/^\s*>\s?/.test(line)) {
      const quoted: string[] = []
      while (index < lines.length && /^\s*>\s?/.test(lines[index] as string)) {
        quoted.push((lines[index] as string).replace(/^\s*>\s?/, ''))
        index += 1
      }
      blocks.push(
        <blockquote key={`q-${index}`}>{renderInline(quoted.join(' '), `q${index}`)}</blockquote>,
      )
      continue
    }

    const bullet = /^\s*[-*+]\s+(.*)$/.exec(line)
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line)
    if (bullet || numbered) {
      const ordered = Boolean(numbered)
      const items: string[] = []
      while (index < lines.length) {
        const current = lines[index] as string
        const match = ordered
          ? /^\s*\d+[.)]\s+(.*)$/.exec(current)
          : /^\s*[-*+]\s+(.*)$/.exec(current)
        if (!match) break
        items.push(match[1] ?? '')
        index += 1
      }
      const ListTag = ordered ? 'ol' : 'ul'
      blocks.push(
        <ListTag key={`list-${index}`}>
          {items.map((item, itemIndex) => (
            <li key={itemIndex}>{renderInline(item, `li${index}-${itemIndex}`)}</li>
          ))}
        </ListTag>,
      )
      continue
    }

    const paragraph: string[] = []
    while (index < lines.length) {
      const current = lines[index] as string
      if (!current.trim() || /^\s*(```|#{1,6}\s|>|[-*+]\s|\d+[.)]\s|\|)/.test(current)) break
      paragraph.push(current.trim())
      index += 1
    }
    if (paragraph.length) {
      blocks.push(<p key={`p-${index}`}>{renderInline(paragraph.join(' '), `p${index}`)}</p>)
    } else {
      index += 1
    }
  }

  return blocks
}

export const Markdown = memo(function Markdown({ content }: { content: string }) {
  return <div className="markdown">{parseBlocks(content)}</div>
})
