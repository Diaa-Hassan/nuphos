// Usage: node measure.js <port> [outJson]  — measures every cell, prints flags.
const { chromium } = require('/tmp/pw/node_modules/playwright-core')
const fs = require('fs')
const port = process.argv[2] || 8762
const ROWS = [
  ['Idle', 'Idle'], ['Running', 'Running'], ['Unread', 'Unread'], ['Running + unread', 'Running + unread'],
  ['Needs attention (!)', 'Needs attention'], ['Background tools', 'Background tools'], ['Background + unread', 'Background + unread'],
  ['Running + linked PR', 'Running + linked PR'], ['Running + linked PR, pointer on PR line', 'Running + linked PR', 'pr'],
  ['Nested thread running', 'Nested thread running'], ['Folded parent (unread) + hidden running thread', 'Folded parent, unread'],
  ['Pinned running', 'Pinned running'], ['Shared running (not managed)', 'Shared running'],
  ['Long CJK title, running + unread', '調查生產環境叢集中節點記憶體壓力過高導致的大量 Pod 被驅逐問題'],
]
const COLS = ['Rest', 'Hover', 'Selected', 'Selected + hover', 'Focus-visible']
module.exports = { ROWS, COLS, setCell, measure }

async function rowSurface(p, text) {
  const label = p.locator('span.t-marquee').filter({ hasText: new RegExp('^' + text.replace(/[+()]/g, '\\$&') + '$') }).first()
  const btn = label.locator('xpath=ancestor::button[1]')
  return { label, btn, surface: btn.locator('xpath=..') }
}
async function setCell(p, r, col) {
  const { label, btn, surface } = await rowSurface(p, r[1])
  await p.mouse.move(1, 1)
  await p.evaluate(() => document.activeElement && document.activeElement.blur())
  if (col.includes('over')) {
    const target = r[2] === 'pr' ? surface.locator('[aria-label="Linked resources"] span[title]').first() : label
    const bb = await target.boundingBox()
    await p.mouse.move(bb.x + Math.min(20, bb.width / 2), bb.y + bb.height / 2)
  }
  if (col === 'Focus-visible') {
    await p.keyboard.press('Shift')
    await btn.evaluate((b) => b.focus())
    if (!(await btn.evaluate((b) => b.matches(':focus-visible')))) throw new Error('not focus-visible')
  }
  await p.waitForTimeout(250)
  return surface
}
async function measure(surface) {
  return surface.evaluate((s) => {
    const vis = (e) => { const r = e.getBoundingClientRect(); if (!r.width || !r.height) return null
      for (let n = e; n && n !== s.parentElement; n = n.parentElement) { const cs = getComputedStyle(n); if (cs.visibility === 'hidden' || cs.opacity === '0') return null }
      return r }
    const btn = s.querySelector('button'); const parts = []
    const add = (name, e, r) => { r = r || vis(e); if (r) parts.push({ name, l: r.left, r: r.right, t: r.top, b: r.bottom }) }
    add('icon', btn.children[0])
    const title = btn.querySelector('.t-marquee'); const tr = vis(title)
    const range = document.createRange(); range.selectNodeContents(title); const xr = range.getBoundingClientRect()
    if (tr) add('title', null, tr) // the whole clip box: text and its fade both live inside it
    btn.querySelectorAll('[role=button], kbd').forEach((e) => add(/threads/.test(e.getAttribute('aria-label')) ? 'chevron' : 'action:' + (e.getAttribute('aria-label') || 'kbd').split(' ')[0], e))
    btn.querySelectorAll('svg, [role=img]').forEach((e) => { if (!e.closest('[role=button]') && !btn.children[0].contains(e)) add('indicator:' + (e.getAttribute('aria-label') || e.closest('[title]')?.title || '?'), e.tagName === 'svg' ? e.parentElement : e) })
    ;[...s.children].filter((c) => c !== btn).forEach((c) => c.querySelectorAll('span[title], [role=button]').forEach((e) => add('resources', e)))
    const br = btn.getBoundingClientRect(), flags = []
    for (const a of parts) { if (a.r > br.right + 0.5 || a.l < br.left - 0.5) flags.push(`${a.name} outside row (${a.l.toFixed(1)}–${a.r.toFixed(1)} vs ${br.left}–${br.right})`) }
    for (let i = 0; i < parts.length; i++) for (let j = i + 1; j < parts.length; j++) {
      const a = parts[i], b = parts[j]
      if (a.name.startsWith('resources') && b.name.startsWith('resources')) continue
      if (a.b <= b.t || b.b <= a.t) continue // different lines
      const gap = Math.max(b.l - a.r, a.l - b.r)
      if (gap < 4) flags.push(`${a.name} ↔ ${b.name}: ${gap < 0 ? 'overlap ' + (-gap).toFixed(1) : 'gap ' + gap.toFixed(1)}px`)
    }
    const t = parts.find((x) => x.name === 'title')
    return { titleRight: t && t.r, parts: parts.map((p) => `${p.name}[${p.l.toFixed(0)}-${p.r.toFixed(0)}]`), flags }
  })
}
if (require.main === module) (async () => {
  const b = await chromium.launch({ executablePath: '/home/node/.cache/ms-playwright/browsers/chromium-1248/chrome-linux64/chrome', args: ['--no-sandbox'] })
  const out = []
  for (const theme of ['dark', 'light']) for (const col of COLS) {
    const p = await b.newPage({ viewport: { width: 260, height: 900 } })
    await p.goto(`http://localhost:${port}/#${theme}${col.startsWith('Selected') ? '-sel' : ''}`); await p.waitForTimeout(500)
    for (const r of ROWS) { const m = await measure(await setCell(p, r, col)); out.push({ theme, col, row: r[0], ...m }) }
    await p.close()
  }
  await b.close()
  // No reflow: a row's title box must end at the same x in every interaction.
  for (const c of out) {
    const rest = out.find((o) => o.theme === c.theme && o.row === c.row && o.col === 'Rest')
    if (Math.abs(c.titleRight - rest.titleRight) > 0.5) c.flags.push(`title reflows ${(rest.titleRight - c.titleRight).toFixed(1)}px vs Rest`)
  }
  const bad = out.filter((c) => c.flags.length)
  for (const c of bad) console.log(`${c.theme} | ${c.row} | ${c.col}: ${c.flags.join('; ')}`)
  console.log(`cells=${out.length} flagged=${bad.length}`)
  if (process.argv[3]) fs.writeFileSync(process.argv[3], JSON.stringify(out, null, 1))
  process.exitCode = bad.length ? 1 : 0
})()
