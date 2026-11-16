import { extname } from 'node:path'

import { parse } from '@babel/parser'

import { toLower } from './util.ts'

export interface CodeSymbol {
  name: string
  kind: string
  line: number
  exported?: boolean
  parent?: string
}

export interface AstReference {
  line: number
  column: number
  kind: string
  snippet: string
}

const TS_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts'])
const JS_EXTENSIONS = new Set(['.js', '.jsx', '.mjs', '.cjs'])

const META_KEYS = new Set([
  'loc',
  'start',
  'end',
  'range',
  'extra',
  'errors',
  'tokens',
  'comments',
  'leadingComments',
  'trailingComments',
  'innerComments',
  'interpreter',
])

const MAX_SYMBOLS_PER_FILE = 400
const PARSE_CACHE_LIMIT = 256
const parseCache = new Map<string, any>()

const contentKey = (path: string, content: string): string => {
  let hash = 2166136261
  for (let index = 0; index < content.length; index += 1) {
    hash ^= content.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return `${path}:${content.length}:${hash >>> 0}`
}

export function supportsAst(path: string): boolean {
  const extension = toLower(extname(path))
  return TS_EXTENSIONS.has(extension) || JS_EXTENSIONS.has(extension)
}

export function parseProgram(path: string, content: string): any {
  if (!supportsAst(path)) return null
  const extension = toLower(extname(path))
  const plugins: string[] = []
  if (TS_EXTENSIONS.has(extension)) plugins.push('typescript')
  if (extension === '.tsx' || JS_EXTENSIONS.has(extension)) plugins.push('jsx')
  const key = contentKey(path, content)
  const cached = parseCache.get(key)
  if (cached !== undefined) {
    parseCache.delete(key)
    parseCache.set(key, cached)
    return cached
  }
  try {
    const program = parse(content, {
      sourceType: 'unambiguous',
      allowReturnOutsideFunction: true,
      errorRecovery: true,
      ...(plugins.length > 0 ? { plugins: plugins as never } : {}),
    }).program
    if (content.length <= 1_000_000) {
      parseCache.set(key, program)
      if (parseCache.size > PARSE_CACHE_LIMIT) {
        const oldest = parseCache.keys().next().value
        if (oldest !== undefined) parseCache.delete(oldest)
      }
    }
    return program
  } catch {
    return null
  }
}

export function walkAst(
  node: any,
  visit: (node: any, parent: any) => void,
  parent: any = null,
): void {
  if (node === null || typeof node !== 'object') return
  if (typeof node.type === 'string') visit(node, parent)
  for (const key of Object.keys(node)) {
    if (META_KEYS.has(key)) continue
    const value = (node as Record<string, unknown>)[key]
    if (Array.isArray(value)) {
      for (const child of value) {
        if (child !== null && typeof child === 'object') walkAst(child, visit, node)
      }
    } else if (value !== null && typeof value === 'object') {
      walkAst(value, visit, node)
    }
  }
}

export function lineAt(content: string, line: number): string {
  if (line < 1) return ''
  let current = 1
  let start = 0
  for (let index = 0; index <= content.length; index += 1) {
    if (index === content.length || content.charCodeAt(index) === 10) {
      if (current === line) {
        const raw = content.slice(start, index).trim()
        return raw.length > 240 ? `${raw.slice(0, 240)}…` : raw
      }
      current += 1
      start = index + 1
    }
  }
  return ''
}

const identifierName = (node: any): string => {
  if (node === null || typeof node !== 'object') return ''
  if (typeof node.name === 'string') return node.name
  if (typeof node.value === 'string' || typeof node.value === 'number') return String(node.value)
  if (node.id !== undefined) return identifierName(node.id)
  return ''
}

const bindingNames = (node: any): string[] => {
  if (node === null || typeof node !== 'object') return []
  if (typeof node.name === 'string') return [node.name]
  if (Array.isArray(node.elements)) {
    return node.elements.flatMap((element: any) => bindingNames(element?.argument ?? element))
  }
  if (Array.isArray(node.properties)) {
    return node.properties.flatMap((property: any) =>
      bindingNames(property?.value ?? property?.argument ?? property),
    )
  }
  return []
}

const startLine = (node: any): number => {
  const line = node?.loc?.start?.line
  return typeof line === 'number' ? line : 0
}

const declarationKind = (node: any): string => {
  switch (node.type) {
    case 'FunctionDeclaration':
    case 'TSDeclareFunction':
      return 'function'
    case 'ClassDeclaration':
      return 'class'
    case 'TSInterfaceDeclaration':
      return 'interface'
    case 'TSTypeAliasDeclaration':
      return 'type'
    case 'TSEnumDeclaration':
      return 'enum'
    case 'TSModuleDeclaration':
      return 'namespace'
    default:
      return ''
  }
}

function collectDeclaration(
  node: any,
  exported: boolean,
  symbols: CodeSymbol[],
  parent?: string,
): void {
  if (symbols.length >= MAX_SYMBOLS_PER_FILE || node === null || typeof node !== 'object') return
  if (node.type === 'VariableDeclaration') {
    for (const declarator of node.declarations ?? []) {
      if (symbols.length >= MAX_SYMBOLS_PER_FILE) return
      const valueKind = declarator?.init?.type
      const kind =
        valueKind === 'ArrowFunctionExpression' || valueKind === 'FunctionExpression'
          ? 'function'
          : valueKind === 'ClassExpression'
            ? 'class'
            : 'variable'
      for (const name of bindingNames(declarator?.id)) {
        if (symbols.length >= MAX_SYMBOLS_PER_FILE) return
        symbols.push({ name, kind, line: startLine(declarator), exported })
      }
    }
    return
  }
  const kind = declarationKind(node)
  if (kind !== '') {
    const name = identifierName(node.id) || 'default'
    symbols.push({
      name,
      kind,
      line: startLine(node),
      exported,
      ...(parent !== undefined ? { parent } : {}),
    })
    if (node.type === 'ClassDeclaration') collectClassMembers(node, name, symbols)
    return
  }
  if (node.type === 'ExportDefaultDeclaration') {
    const declaration = node.declaration
    if (declaration !== null && typeof declaration === 'object') {
      if (declaration.type === 'FunctionDeclaration' || declaration.type === 'ClassDeclaration') {
        collectDeclaration(declaration, true, symbols, parent)
      } else if (
        declaration.type === 'ArrowFunctionExpression' ||
        declaration.type === 'FunctionExpression'
      ) {
        symbols.push({
          name: 'default',
          kind: 'function',
          line: startLine(declaration),
          exported: true,
        })
      } else if (declaration.type === 'ClassExpression') {
        symbols.push({
          name: 'default',
          kind: 'class',
          line: startLine(declaration),
          exported: true,
        })
      }
    }
  }
}

function collectClassMembers(node: any, className: string, symbols: CodeSymbol[]): void {
  const body = node.body?.body
  if (!Array.isArray(body)) return
  for (const member of body) {
    if (symbols.length >= MAX_SYMBOLS_PER_FILE) return
    if (member === null || typeof member !== 'object') continue
    if (
      member.type !== 'ClassMethod' &&
      member.type !== 'ClassPrivateMethod' &&
      member.type !== 'TSDeclareMethod'
    ) {
      continue
    }
    const name = identifierName(member.key)
    if (name === '') continue
    symbols.push({ name, kind: 'method', line: startLine(member), parent: className })
  }
}

export function extractCodeSymbols(path: string, content: string): CodeSymbol[] | null {
  const program = parseProgram(path, content)
  if (program === null) return null
  const symbols: CodeSymbol[] = []
  for (const statement of program.body ?? []) {
    if (statement === null || typeof statement !== 'object') continue
    const exported =
      statement.type === 'ExportNamedDeclaration' ||
      statement.type === 'ExportDefaultDeclaration' ||
      statement.type === 'ExportAllDeclaration'
    const declaration =
      statement.type === 'ExportNamedDeclaration' || statement.type === 'ExportDefaultDeclaration'
        ? statement.declaration
        : statement
    if (declaration !== null && declaration !== undefined) {
      collectDeclaration(declaration, exported, symbols)
    } else if (statement.type === 'ExportNamedDeclaration') {
      for (const specifier of statement.specifiers ?? []) {
        const name = identifierName(specifier?.exported ?? specifier?.local)
        if (name !== '')
          symbols.push({ name, kind: 'export', line: startLine(specifier), exported: true })
      }
    }
  }
  return symbols.slice(0, MAX_SYMBOLS_PER_FILE)
}

export function countImportsAst(path: string, content: string): number | null {
  const program = parseProgram(path, content)
  if (program === null) return null
  let count = 0
  for (const statement of program.body ?? []) {
    if (statement?.type === 'ImportDeclaration') count += 1
    else if (statement?.type === 'ExportAllDeclaration' && statement.source) count += 1
    else if (statement?.type === 'ExportNamedDeclaration' && statement.source) count += 1
  }
  return count
}

const classifyReference = (node: any, parent: any): string | null => {
  if (parent === null || typeof parent !== 'object') return 'reference'
  if (parent.type === 'MemberExpression' && parent.property === node && parent.computed !== true) {
    return null
  }
  if (parent.type === 'ObjectProperty' && parent.key === node && parent.computed !== true) {
    return null
  }
  if (parent.type === 'ObjectMethod' && parent.key === node) return null
  if (parent.type === 'ClassMethod' && parent.key === node) return null
  if (parent.type === 'CallExpression' && parent.callee === node) return 'call'
  if (parent.type === 'NewExpression' && parent.callee === node) return 'constructor'
  if (parent.type === 'JSXOpeningElement' || parent.type === 'JSXClosingElement') return 'jsx'
  if (
    parent.type === 'FunctionDeclaration' ||
    parent.type === 'FunctionExpression' ||
    parent.type === 'ArrowFunctionExpression' ||
    parent.type === 'ClassDeclaration' ||
    parent.type === 'ClassExpression' ||
    parent.type === 'VariableDeclarator' ||
    parent.type === 'TSInterfaceDeclaration' ||
    parent.type === 'TSTypeAliasDeclaration' ||
    parent.type === 'TSEnumDeclaration' ||
    parent.type === 'ImportSpecifier' ||
    parent.type === 'ImportDefaultSpecifier' ||
    parent.type === 'ImportNamespaceSpecifier'
  ) {
    return 'declaration'
  }
  return 'reference'
}

export function findAstReferences(
  path: string,
  content: string,
  symbol: string,
  limit = 500,
): AstReference[] | null {
  const program = parseProgram(path, content)
  if (program === null) return null
  const references: AstReference[] = []
  const seen = new Set<string>()
  walkAst(program, (node, parent) => {
    if (references.length >= limit) return
    if (node.type !== 'Identifier' || node.name !== symbol) return
    const kind = classifyReference(node, parent)
    if (kind === null) return
    const line = startLine(node)
    const column = (node.loc?.start?.column ?? 0) + 1
    const key = `${line}:${column}`
    if (seen.has(key)) return
    seen.add(key)
    references.push({ line, column, kind, snippet: lineAt(content, line) })
  })
  return references
}

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export function findTextReferences(content: string, symbol: string, limit = 500): AstReference[] {
  if (symbol === '') return []
  let matcher: RegExp
  try {
    matcher = new RegExp(`\\b${escapeRegExp(symbol)}\\b`)
  } catch {
    return []
  }
  const references: AstReference[] = []
  const lines = content.split('\n')
  for (let index = 0; index < lines.length && references.length < limit; index += 1) {
    const line = lines[index] as string
    const match = matcher.exec(line)
    if (match === null) continue
    references.push({
      line: index + 1,
      column: match.index + 1,
      kind: 'reference',
      snippet: line.trim().slice(0, 240),
    })
  }
  return references
}
