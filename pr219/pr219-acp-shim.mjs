#!/usr/bin/env node
// E2E shim for nuphos/nuphos#219: runs the real claude-agent-acp unchanged and, while
// /tmp/sweep219-inject exists, adds ONE extra session/update to the first turn: a Bash
// tool_call left at status "pending" that never runs — what claude-agent-acp emits for a
// streamed tool_use that is abandoned. Everything else passes through byte for byte.
import { spawn } from 'node:child_process'
import { existsSync, unlinkSync, appendFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createInterface } from 'node:readline'
const real = join(dirname(fileURLToPath(import.meta.url)), 'index.real.js')
const child = spawn(process.execPath, [real, ...process.argv.slice(2)], { stdio: ['pipe', 'pipe', 'inherit'], env: process.env })
process.stdin.pipe(child.stdin)
let injected = false
createInterface({ input: child.stdout, crlfDelay: Infinity }).on('line', (line) => {
  process.stdout.write(line + '\n')
  if (injected || !existsSync('/tmp/sweep219-inject')) return
  let m; try { m = JSON.parse(line) } catch { return }
  if (m.method !== 'session/update' || m.params?.update?.sessionUpdate !== 'agent_message_chunk') return
  injected = true; try { unlinkSync('/tmp/sweep219-inject') } catch {}
  const id = `toolu_e2e_abandoned_${Date.now()}`
  const upd = { jsonrpc: '2.0', method: 'session/update', params: { sessionId: m.params.sessionId, update: {
    sessionUpdate: 'tool_call', toolCallId: id, title: 'Terminal', kind: 'execute', status: 'pending', rawInput: {},
    content: [{ type: 'terminal', terminalId: id }], _meta: { claudeCode: { toolName: 'Bash' }, terminal_info: { terminal_id: id } } } } }
  process.stdout.write(JSON.stringify(upd) + '\n')
  appendFileSync('/tmp/sweep219-shim.log', `${new Date().toISOString()} injected ${id} into ${m.params.sessionId}\n`)
})
child.on('exit', (code, sig) => process.exit(code ?? (sig ? 1 : 0)))
for (const s of ['SIGINT', 'SIGTERM']) process.on(s, () => child.kill(s))
