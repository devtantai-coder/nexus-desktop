const send = (message) => {
  const body = JSON.stringify(message)
  process.stdout.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`)
}

let buffer = Buffer.alloc(0)
process.stdin.on('data', (chunk) => {
  buffer = Buffer.concat([buffer, chunk])
  for (;;) {
    const headerEnd = buffer.indexOf('\r\n\r\n')
    if (headerEnd < 0) return
    const header = buffer.slice(0, headerEnd).toString()
    const match = /Content-Length:\s*(\d+)/i.exec(header)
    if (!match) {
      buffer = buffer.slice(headerEnd + 4)
      continue
    }
    const total = headerEnd + 4 + Number(match[1])
    if (buffer.length < total) return
    const body = buffer.slice(headerEnd + 4, total).toString()
    buffer = buffer.slice(total)
    handle(JSON.parse(body))
  }
})

const handle = (message) => {
  const { id, method, params } = message
  if (method === 'initialize') {
    send({ jsonrpc: '2.0', id, result: { capabilities: {} } })
    return
  }
  if (method === 'textDocument/didOpen') {
    const uri = params?.textDocument?.uri ?? ''
    send({
      jsonrpc: '2.0',
      method: 'textDocument/publishDiagnostics',
      params: {
        uri,
        diagnostics: [
          {
            range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
            severity: 1,
            message: 'mock diagnostic',
          },
        ],
      },
    })
    return
  }
  if (method === 'textDocument/hover') {
    send({
      jsonrpc: '2.0',
      id,
      result: { contents: { kind: 'markdown', value: '**mock hover**' } },
    })
    return
  }
  if (method === 'textDocument/definition') {
    send({
      jsonrpc: '2.0',
      id,
      result: { uri: params?.textDocument?.uri ?? '', range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } } },
    })
    return
  }
  if (method === 'textDocument/references') {
    send({ jsonrpc: '2.0', id, result: [] })
    return
  }
  if (method === 'textDocument/diagnostic') {
    send({ jsonrpc: '2.0', id, result: { kind: 'full', items: [] } })
    return
  }
  if (id !== undefined) send({ jsonrpc: '2.0', id, result: null })
}

process.stdin.resume()