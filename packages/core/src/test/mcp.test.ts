import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'
import { EventBus } from '../events.ts'
import { McpManager } from '../mcp.ts'
import { SecretStore } from '../secrets.ts'
import { Store } from '../store.ts'

let tempDir = ''
let store: Store
let mcp: McpManager

before(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'nexus-mcp-test-'))
  const serverPath = join(tempDir, 'mcp_server.py')
  writeFileSync(
    serverPath,
    `import json, sys

def send(payload):
    sys.stdout.write(json.dumps(payload) + "\\n")
    sys.stdout.flush()

for line in sys.stdin:
    line = line.strip()
    if not line:
        continue
    message = json.loads(line)
    if "id" not in message:
        continue
    method = message.get("method")
    if method == "initialize":
        send({"jsonrpc": "2.0", "id": message["id"], "result": {"protocolVersion": "2024-11-05", "capabilities": {"tools": {}}, "serverInfo": {"name": "mock", "version": "1"}}})
    elif method == "tools/list":
        send({"jsonrpc": "2.0", "id": message["id"], "result": {"tools": [{"name": "echo", "description": "Echo input", "inputSchema": {"type": "object", "properties": {"text": {"type": "string"}}}}]}})
    elif method == "tools/call":
        arguments = message.get("params", {}).get("arguments", {})
        send({"jsonrpc": "2.0", "id": message["id"], "result": {"content": [{"type": "text", "text": "echo:" + json.dumps(arguments, sort_keys=True)}]}})
    else:
        send({"jsonrpc": "2.0", "id": message["id"], "error": {"code": -32601, "message": "unknown"}})
`,
  )
  store = new Store(join(tempDir, 'nexus.db'))
  store.migrate()
  store.seedDefaults()
  store.settingSet('mcp.servers', [
    { id: 'mock', command: 'python3', args: [serverPath], enabled: true },
  ])
  const events = new EventBus()
  const secrets = new SecretStore(tempDir)
  mcp = new McpManager(store, secrets, events)
})

after(async () => {
  await mcp.close()
  store.close()
  rmSync(tempDir, { recursive: true, force: true })
})

describe('McpManager (stdio)', () => {
  it('mock server được list', async () => {
    const servers = await mcp.listServers()
    assert.equal(servers.length, 1)
    assert.equal(servers[0]?.['id'], 'mock')
  })

  it('list_tools trả về echo', async () => {
    const tools = await mcp.listTools('mock')
    assert.equal(tools.length, 1)
    assert.equal(tools[0]?.['name'], 'echo')
  })

  it('agent_tools sinh namespacedName', async () => {
    const tools = await mcp.agentTools()
    assert.equal(tools.length, 1)
    assert.match(String(tools[0]?.['name']), /^mcp__mock__echo$/)
  })

  it('call_namespaced gọi mock server', async () => {
    const tools = await mcp.agentTools()
    const namespaced = String(tools[0]?.['name'])
    const result = await mcp.callNamespaced(namespaced, { text: 'hello' })
    const content = (result as { content?: unknown[] }).content ?? []
    assert.equal(content.length, 1)
    assert.match(JSON.stringify(content[0]), /hello/)
  })
})
