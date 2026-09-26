/**
 * Visual confirmation for the SERVICE path of the icon theme: a live DSH host
 * with `dsh-better-sidebar` mounted, whose explorer the theme dresses through
 * `ctx.betterSidebar.registerFileIcon`.
 *
 * Requires an authenticated URL (the one `dsh web` prints), e.g.
 *
 *   dsh web --port 3099 --no-open
 *
 * Usage:  node <this> <authenticated-url> [out-dir]
 *
 * Facts it records, per explorer row and per tab chip: the themed `<img>` (its
 * src and the icon file it resolves to) and whether ANY host-drawn glyph is
 * still present beside it. The final round removes the theme's images in place,
 * which is the control shot: whatever changes is the theme's doing.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

async function loadPlaywright() {
  const require = createRequire(import.meta.url)
  const roots = [null, process.env.PLAYWRIGHT_ROOT ?? join(process.env.APPDATA ?? '', 'npm', 'node_modules')]
  for (const root of roots) {
    try {
      const spec = root === null ? 'playwright' : join(root, 'playwright')
      const loaded = await import(pathToFileURL(require.resolve(spec)).href)
      return loaded.chromium ?? loaded.default?.chromium
    } catch { /* next root */ }
  }
  throw new Error('playwright not found: npm install -g playwright && npx playwright install chromium')
}

const chromium = await loadPlaywright()
const url = process.argv[2]
const out = process.argv[3] ?? join(process.cwd(), '.visual', 'service')
mkdirSync(out, { recursive: true })

const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 1600, height: 950 } })
const page = await context.newPage()
const logs = []
page.on('console', message => logs.push(`[${message.type()}] ${message.text()}`))
page.on('pageerror', error => logs.push(`[pageerror] ${error.message}`))

const shot = async name => {
  await page.screenshot({ path: join(out, `${name}.png`) })
  console.log(`shot: ${name}.png`)
}

const facts = () => page.evaluate(() => {
  const panel = document.querySelector('[data-sidebar-right-panel]')
  const themed = el => el.querySelector('img[data-dsh-file-icon-service-img]')
  /** Every glyph the HOST drew for an element, themed or not. */
  const hostGlyphs = el => Array.from(el.querySelectorAll('svg')).length
  /**
   * The explorer's rows. Better-sidebar draws a row as a `div[role="button"]`
   * (one of them per file/folder) with the label in a `*_explorerName` span —
   * no `li`, no `<button>`, and its CSS-module hashes are not stable across
   * releases, so the anchors here are the ROLE and the panel, not a class name.
   */
  const rows = Array.from(document.querySelectorAll('[data-sidebar-right-panel] div[role="button"]'))
    .filter(row => row.querySelector('span') !== null)
  return {
    bootFailed: (document.body.innerText ?? '').includes('Failed to load plugins'),
    activePluginErrors: Array.from(document.querySelectorAll('pre, [data-dsh-boot-failed]'))
      .map(el => (el.textContent ?? '').slice(0, 200)).filter(text => text.includes('did not activate')),
    panelFound: panel !== null,
    themedImgs: document.querySelectorAll('img[data-dsh-file-icon-service-img]').length,
    overlayImgs: document.querySelectorAll('img[data-dsh-file-icon-overlay-img]').length,
    nativeRows: document.querySelectorAll('[data-files-entry]').length,
    rows: rows.slice(0, 24).map(row => {
      const img = themed(row)
      return {
        text: (row.textContent ?? '').trim().slice(0, 28),
        expanded: row.getAttribute('aria-expanded'),
        themedSrc: img?.getAttribute('src') ?? null,
        themedSize: img === null ? null : `${img.getAttribute('width')}x${img.getAttribute('height')}`,
        hostGlyphs: hostGlyphs(row),
      }
    }),
    chips: Array.from(document.querySelectorAll('span[data-sidebar-right-tab], [data-sidebar-right-tab]'))
      .filter(el => el.tagName === 'SPAN')
      .map(el => ({
        text: (el.textContent ?? '').trim().slice(0, 26),
        themedSrc: themed(el)?.getAttribute('src') ?? null,
        hostGlyphs: hostGlyphs(el),
      })),
  }
})

await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 })
await page.waitForTimeout(9000)

const boot = await facts()
if (boot.bootFailed) {
  console.error('the plugin failed to activate:\n' + boot.activePluginErrors.join('\n'))
}

// Open the right Sidebar, then the explorer from the guide.
await page.evaluate(() => {
  const panel = document.querySelector('[data-sidebar-right-panel]')
  if (panel === null || panel.getAttribute('data-sidebar-right-open') === null) {
    document.querySelector('[data-sidebar-right-expand]')?.click()
  }
})
await page.waitForTimeout(2500)

if (await page.evaluate(() => document.querySelector('[data-sidebar-right-guide-entry]') === null
  && document.querySelector('[data-files-root]') === null)) {
  const addTab = await page.$('[data-dockkit-add-tab]')
  if (addTab !== null && await addTab.isVisible()) { await addTab.click(); await page.waitForTimeout(2000) }
}

const opened = await page.evaluate(() => {
  const entries = Array.from(document.querySelectorAll('[data-sidebar-right-guide-entry]'))
  const files = entries.find(el => el.getAttribute('data-sidebar-right-guide-entry') === 'files')
  const wanted = files ?? entries[0]
  if (wanted === undefined) return null
  const label = (wanted.textContent ?? '').trim().slice(0, 40)
  wanted.click()
  return { kind: wanted.getAttribute('data-sidebar-right-guide-entry'), label, others: entries.length - 1 }
})
console.log('opened explorer entry:', JSON.stringify(opened))
await page.waitForTimeout(4500)

// Expand a few directories so both closed and open folder glyphs are on screen.
for (let round = 1; round <= 3; round++) {
  const clicked = await page.evaluate(() => {
    const panel = document.querySelector('[data-sidebar-right-panel]')
    if (panel === null) return 0
    // Better-sidebar's directory rows are the role=button divs that are not
    // already expanded (an expanded one carries aria-expanded="true").
    const closed = Array.from(panel.querySelectorAll('div[role="button"]'))
      .filter(row => row.getAttribute('aria-expanded') !== 'true')
    for (const row of closed.slice(0, 8)) row.click()
    return closed.length
  })
  console.log(`round ${round}: expandable rows ${clicked}`)
  if (clicked === 0) break
  await page.waitForTimeout(2500)
}
await shot('50-explorer-service-path')

const themed = await facts()
writeFileSync(join(out, 'facts-service.json'), JSON.stringify(themed, null, 2))
console.log('--- service path ---')
console.log(JSON.stringify({
  bootFailed: themed.bootFailed,
  themedImgs: themed.themedImgs,
  overlayImgs: themed.overlayImgs,
  nativeRows: themed.nativeRows,
  chips: themed.chips,
}, null, 1))
console.log('rows:')
for (const row of themed.rows) console.log(' ', JSON.stringify(row))

// Open a FILE so the editor tab (and its chip icon) joins the strip. A file row
// is a role=button div with no expansion state; `default_folder*` in the themed
// image is what distinguishes the rows that are directories.
const file = await page.evaluate(() => {
  const panel = document.querySelector('[data-sidebar-right-panel]')
  if (panel === null) return null
  const candidates = Array.from(panel.querySelectorAll('div[role="button"]'))
    .filter(row => row.getAttribute('aria-expanded') === null)
    .filter(row => {
      const src = row.querySelector('img[data-dsh-file-icon-service-img]')?.getAttribute('src') ?? ''
      return !src.includes('default_folder') && !src.includes('folder_type_')
    })
  const target = candidates.find(row => /\.(md|json|ts|mjs|yml)$/i.test(row.textContent ?? '')) ?? candidates[0]
  if (target === undefined) return null
  const name = (target.textContent ?? '').trim().slice(0, 30)
  target.click()
  return name
})
console.log('clicked file:', file)
await page.waitForTimeout(4000)
await shot('51-file-tab-service-path')

const withFile = await facts()
writeFileSync(join(out, 'facts-service-file-tab.json'), JSON.stringify(withFile, null, 2))
console.log('--- chips after opening a file ---')
console.log(JSON.stringify(withFile.chips, null, 1))

// Control: strip the theme's images in place. The rows should fall back to
// whatever the host draws on its own.
await page.evaluate(() => {
  for (const node of document.querySelectorAll('img[data-dsh-file-icon-service-img]')) node.remove()
})
await page.waitForTimeout(1200)
await shot('52-control-service-imgs-removed')

console.log('--- page logs ---\n' + logs.slice(-25).join('\n'))
await browser.close()
