// node scenario219.mjs <cdpPort> <outDir> <caption>
import { mkdirSync, writeFileSync, appendFileSync } from 'node:fs'
const [port, out, caption] = process.argv.slice(2)
mkdirSync(`${out}/frames`, { recursive: true })
const log = (...a) => { const l = `[${new Date().toISOString()}] ${a.join(' ')}`; console.log(l); appendFileSync(`${out}/run.log`, l + '\n') }
const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
const page = targets.find(t => t.type === 'page' && !t.url.startsWith('devtools'))
const ws = new WebSocket(page.webSocketDebuggerUrl)
let id = 0; const pending = new Map(); let n = 0; const frames = []
ws.onmessage = e => { const m = JSON.parse(e.data)
  if (m.method === 'Page.screencastFrame') { const f = `${out}/frames/${String(n++).padStart(5,'0')}.jpg`; writeFileSync(f, Buffer.from(m.params.data, 'base64')); frames.push([f, m.params.metadata.timestamp]); send('Page.screencastFrameAck', { sessionId: m.params.sessionId }); return }
  if (pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) } }
await new Promise(r => ws.onopen = r)
const send = (method, params = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) })
const ev = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result?.result?.value
const sleep = ms => new Promise(r => setTimeout(r, ms))
const click = async (re) => { const pt = await ev(`(()=>{const re=${re};const el=[...document.querySelectorAll('button,a,[role=button]')].filter(e=>e.getClientRects().length).find(e=>re.test((e.getAttribute('aria-label')||'').trim())||re.test((e.title||'').trim())||re.test((e.innerText||'').trim()));if(!el)return null;const b=el.getBoundingClientRect();return {x:b.x+b.width/2,y:b.y+b.height/2}})()`); if (!pt) return false; for (const type of ['mouseMoved','mousePressed','mouseReleased']) await send('Input.dispatchMouseEvent', { type, x: pt.x, y: pt.y, button: 'left', clickCount: 1 }); return true }
const setCaption = (t) => ev(`(()=>{let d=document.getElementById('e2e-cap');if(!d){d=document.createElement('div');d.id='e2e-cap';d.style.cssText='position:fixed;left:50%;bottom:8px;transform:translateX(-50%);z-index:2147483647;background:rgba(0,0,0,.85);color:#fff;font:600 14px -apple-system,sans-serif;padding:6px 12px;border-radius:6px;pointer-events:none;max-width:90vw;text-align:center';document.body.appendChild(d)};d.textContent=${JSON.stringify(caption + ' — ')}+${JSON.stringify(t)}})()`)
const indicators = () => ev(`(()=>{const t=document.body.innerText;return {runningShell:/\\d+ running shell/i.test(t), bgStill:/Background tools are still running/i.test(t), match:(t.match(/[^\\n]*(running shell|Background tools)[^\\n]*/gi)||[]).slice(0,4)}})()`)
await send('Page.enable')
await click('/^Close modal$/'); await sleep(500)
await click('/^New chat/'); await sleep(1500)
await send('Page.startScreencast', { format: 'jpeg', quality: 70, maxWidth: 1400, maxHeight: 900, everyNthFrame: 2 })
await setCaption('1/3 new chat; adapter shim will add one never-started Bash tool_call (status pending) to this turn')
writeFileSync('/tmp/sweep219-inject', '1')
await ev(`document.querySelector('.atlas-composer').focus()`)
await send('Input.insertText', { text: 'Reply with exactly one word: ok' })
await sleep(300)
for (const type of ['keyDown','keyUp']) await send('Input.dispatchKeyEvent', { type, key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
log('sent prompt')
const stopShown = () => ev(`[...document.querySelectorAll('button')].some(b => /^Stop agent/.test(b.getAttribute('aria-label') || b.title || ''))`)
let started = false
for (let i = 0; i < 300 && !started; i++) { await sleep(200); started = await stopShown() }
log('turn started:', started)
let running = true
for (let i = 0; i < 600 && running; i++) { await sleep(300); running = await stopShown() }
log('turn ended')
await setCaption('2/3 turn ended (reply received) — watching the running-shell indicator for 20 s')
let ind
for (let s = 0; s < 20; s++) { await sleep(1000); ind = await indicators() }
log('after 20s:', JSON.stringify(ind))
await setCaption(`4/4 result after 20 s: ${ind.runningShell || ind.bgStill ? 'STALE "running shell" indicator still shown' : 'no running-shell indicator'}`)
await sleep(2500)
const shot = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(`${out}/final.png`, Buffer.from(shot.result.data, 'base64'))
await send('Page.stopScreencast'); await sleep(300)
let concat = ''; for (let i = 0; i < frames.length; i++) { const d = i + 1 < frames.length ? frames[i+1][1] - frames[i][1] : 1; concat += `file '${frames[i][0]}'\nduration ${Math.max(d, 0.02).toFixed(3)}\n` }
concat += `file '${frames.at(-1)[0]}'\n`; writeFileSync(`${out}/frames.txt`, concat)
log('frames', frames.length, 'DONE')
ws.close(); process.exit(0)
