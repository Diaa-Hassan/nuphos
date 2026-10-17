// node matrix.js — renders before/after state matrices per theme; fails if any after-cell overlaps.
const { chromium } = require('/tmp/pw/node_modules/playwright-core')
const { ROWS, COLS, setCell, measure } = require('./measure.js')
const VERS = [['Before — main 411ab00 (#326 overlay)', 8761, false], ['After — #450 191ac57 (one fixed-width trailing slot)', 8762, true]]
;(async () => {
  const b = await chromium.launch({ executablePath: '/home/node/.cache/ms-playwright/browsers/chromium-1248/chrome-linux64/chrome', args: ['--no-sandbox'] })
  const failures = []
  for (const theme of ['dark', 'light']) {
    const blocks = []
    for (const [vname, port, assert] of VERS) {
      const grid = ROWS.map(() => [])
      for (const col of COLS) {
        const p = await b.newPage({ viewport: { width: 260, height: 900 }, deviceScaleFactor: 2 })
        await p.goto(`http://localhost:${port}/#${theme}${col.startsWith('Selected') ? '-sel' : ''}`); await p.waitForTimeout(600)
        for (let i = 0; i < ROWS.length; i++) {
          const surface = await setCell(p, ROWS[i], col)
          const m = await measure(surface)
          if (assert) { const rest = grid[i][0]; if (rest && Math.abs(rest.titleRight - m.titleRight) > 0.5) m.flags.push('title reflows'); if (m.flags.length) failures.push(`${theme} | ${ROWS[i][0]} | ${col}: ${m.flags.join('; ')}`) }
          const bb = await surface.boundingBox()
          const png = await p.screenshot({ clip: { x: 0, y: bb.y - 3, width: 260, height: bb.height + 6 }, animations: 'disabled' })
          grid[i].push({ titleRight: m.titleRight, src: 'data:image/png;base64,' + png.toString('base64') })
        }
        await p.close()
      }
      blocks.push({ vname, grid })
    }
    const fg = theme === 'dark' ? '#e8e8e8' : '#1a1a1a', bg = theme === 'dark' ? '#111' : '#f4f4f5', line = theme === 'dark' ? '#333' : '#d4d4d8'
    const html = `<html><body style="margin:0;background:${bg};color:${fg};font:14px -apple-system,Inter,'DejaVu Sans',sans-serif;padding:16px">
      <div style="font-size:18px;font-weight:600;margin-bottom:4px">Sidebar row: state × interaction (${theme}, 260px sidebar)</div>` +
      blocks.map(({ vname, grid }) => `<div style="font-weight:600;margin:16px 0 6px">${vname}</div>
      <table style="border-collapse:collapse"><tr><th></th>${COLS.map((c) => `<th style="text-align:left;padding:4px 8px">${c}</th>`).join('')}</tr>
      ${grid.map((cells, i) => `<tr style="border-top:1px solid ${line}"><td style="padding:4px 8px;width:190px">${ROWS[i][0]}</td>${cells.map((c) => `<td style="padding:4px 8px;border-left:1px solid ${line}"><img src="${c.src}" style="width:260px;display:block"></td>`).join('')}</tr>`).join('')}</table>`).join('') + '</body></html>'
    const p = await b.newPage({ viewport: { width: 1700, height: 800 }, deviceScaleFactor: 1.5 })
    await p.setContent(html); await p.waitForTimeout(300)
    await p.screenshot({ path: `/tmp/matrix/sidebar-row-state-matrix-${theme}.png`, fullPage: true })
    await p.close()
  }
  await b.close()
  failures.forEach((f) => console.log('FLAG', f))
  console.log(`after-cells flagged: ${failures.length}`)
  if (failures.length) process.exit(1)
})()
