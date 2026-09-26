/**
 * Visual confirmation for the DSH-native file explorer icons.
 *
 * Requires the host on an authenticated URL, with the plugin mounted and the
 * third-party better-sidebar bundle backed out (both register a `files` tab
 * type; the first registration owns the guide entry), e.g.
 *
 *   dsh web --patch scripts/only-native-explorer.yml --port 3099 --no-open
 *
 * Usage:  node <this> <authenticated-url> [out-dir]
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
const out = process.argv[3] ?? join(process.cwd(), '.visual')
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

/** The overlay facts, read the way the plugin itself reads them. */
const facts = () => page.evaluate(() => {
  const findDeep = (host, selector) => {
    for (const child of Array.from(host.children)) {
      if (child.matches(selector)) return child
      for (const nested of Array.from(child.children)) if (nested.matches(selector)) return nested
    }
    return null
  }
  const ourImg = el => findDeep(el, 'img[data-dsh-file-icon-overlay-img]')?.getAttribute('src') ?? null
  const hostIcon = el => el.querySelector(':scope > svg')
    ?? Array.from(el.children).map(c => c.querySelector(':scope > svg')).find(svg => svg !== null)
    ?? null
  return {
    root: document.querySelector('[data-files-root]')?.getAttribute('data-files-root') ?? null,
    rows: Array.from(document.querySelectorAll('[data-files-entry]')).map(li => {
      const row = li.querySelector(':scope > button')
      const icon = row === null ? null : hostIcon(row)
      return {
        kind: li.getAttribute('data-files-entry'),
        name: (li.getAttribute('data-files-path') ?? '').split(/[\\/]/).pop(),
        expanded: row?.getAttribute('aria-expanded') ?? null,
        hostIconViewBox: icon?.getAttribute('viewBox') ?? null,
        hostIconHidden: icon === null ? null : getComputedStyle(icon).display === 'none',
        overlay: row === null ? null : ourImg(row),
      }
    }),
    chips: Array.from(document.querySelectorAll('span[data-sidebar-right-tab]')).map(el => {
      const icon = hostIcon(el)
      return {
        text: (el.textContent ?? '').trim().slice(0, 24),
        hostIconViewBox: icon?.getAttribute('viewBox') ?? null,
        hostIconHidden: icon === null ? null : getComputedStyle(icon).display === 'none',
        overlay: ourImg(el),
      }
    }),
    guideEntries: document.querySelectorAll('[data-sidebar-right-guide-entry]').length,
    guideTouched: Array.from(document.querySelectorAll('[data-sidebar-right-guide-entry]'))
      .filter(el => el.hasAttribute('data-dsh-file-icon-overlay')).length,
    overlayImgCount: document.querySelectorAll('img[data-dsh-file-icon-overlay-img]').length,
    markedHosts: document.querySelectorAll('[data-dsh-file-icon-overlay]').length,
    styleInjected: Array.from(document.querySelectorAll('head style'))
      .some(style => (style.textContent ?? '').includes('data-dsh-file-icon-overlay] > svg')),
  }
})

await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 })
await page.waitForTimeout(7000)

// Open the right Sidebar, then the native `files` tab from its guide.
if ((await page.evaluate(() => document.querySelector('[data-sidebar-right-panel]')?.getAttribute('data-sidebar-right-open') ?? null)) === null) {
  const expand = await page.$('[data-sidebar-right-expand]')
  if (expand !== null) { await expand.click(); await page.waitForTimeout(1500) }
}
/** The native files tab is already on screen when its tree, or the guide that
 *  opens it, is present. (`offsetParent` cannot decide this: the slot wrapper
 *  is `display: contents`, so every chip inside it reports no offsetParent.) */
const filesTabOnScreen = () => page.evaluate(() =>
  document.querySelector('[data-files-root]') !== null
  || document.querySelector('[data-sidebar-right-guide-entry="files"]') !== null)

if (!(await filesTabOnScreen())) {
  const addTab = await page.$('[data-dockkit-add-tab]')
  if (addTab !== null && await addTab.isVisible()) { await addTab.click(); await page.waitForTimeout(1500) }
}
const opened = await page.evaluate(() => {
  const button = document.querySelector('[data-sidebar-right-guide-entry="files"]')
  if (button === null) return false
  button.click()
  return true
})
console.log('opened the native files tab:', opened)
await page.waitForTimeout(3500)

// Expand every directory, one level per round, so the tree shows both states.
for (let round = 1; round <= 2; round++) {
  const clicked = await page.evaluate(() => {
    const closed = Array.from(document.querySelectorAll('[data-files-entry="directory"] button[aria-expanded="false"]'))
    for (const button of closed.slice(0, 4)) button.click()
    return closed.length
  })
  console.log(`round ${round}: expanded ${clicked} directories`)
  if (clicked === 0) break
  await page.waitForTimeout(2500)
}
await shot('40-tree-with-plugin')

const withPlugin = await facts()
writeFileSync(join(out, 'facts-with-plugin.json'), JSON.stringify(withPlugin, null, 2))
console.log('--- with the plugin ---')
console.log(JSON.stringify(withPlugin, null, 1))

// Open a file row so the document tab (and its chip) joins the strip.
const openedFile = await page.evaluate(() => {
  const row = document.querySelector('[data-files-entry="file"] button')
  if (row === null) return null
  const name = row.querySelector('span')?.textContent ?? ''
  row.click()
  return name
})
console.log('clicked file row:', openedFile)
await page.waitForTimeout(3500)
await shot('41-file-tab-with-plugin')

const withDocumentTab = await facts()
writeFileSync(join(out, 'facts-with-document-tab.json'), JSON.stringify(withDocumentTab, null, 2))
const panels = await page.evaluate(() => Array.from(document.querySelectorAll('[data-dockkit-pane]')).map(pane => ({
  paneId: pane.getAttribute('data-dockkit-pane'),
  stampedRoot: pane.getAttribute('data-dsh-file-icon-root'),
  chips: Array.from(pane.querySelectorAll('span[data-sidebar-right-tab]')).map(el => ({
    text: (el.textContent ?? '').trim().slice(0, 20),
    marked: el.hasAttribute('data-dsh-file-icon-overlay'),
  })),
  hasTree: pane.querySelector('[data-files-root]') !== null,
})))
writeFileSync(join(out, 'panes.json'), JSON.stringify(panels, null, 2))
console.log('--- panes after opening a file ---')
console.log(JSON.stringify(panels, null, 1))
console.log('--- chips after opening a file ---')
console.log(JSON.stringify(withDocumentTab.chips, null, 1))
console.log('guide entries:', withDocumentTab.guideEntries, 'touched:', withDocumentTab.guideTouched)

// Unmount the plugin's DOM work in place: proves the difference is the plugin.
await page.evaluate(() => {
  for (const node of document.querySelectorAll('img[data-dsh-file-icon-overlay-img]')) node.remove()
  for (const node of document.querySelectorAll('[data-dsh-file-icon-overlay]')) node.removeAttribute('data-dsh-file-icon-overlay')
  for (const style of document.querySelectorAll('head style')) {
    if ((style.textContent ?? '').includes('data-dsh-file-icon-overlay] > svg')) style.remove()
  }
})
await page.waitForTimeout(800)
await shot('42-tree-plugin-unmounted')

console.log('--- page logs ---\n' + logs.slice(-25).join('\n'))
await browser.close()
