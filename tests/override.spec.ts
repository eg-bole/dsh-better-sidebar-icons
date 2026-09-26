// @vitest-environment jsdom
/**
 * DOM overlay tests (src/client/override.ts): the overlay shows the vscode-icons
 * theme images beside the DSH file explorer's own icons: the right Sidebar
 * `files` tab's tree rows (`li[data-files-entry][data-files-path]` with
 * `button[aria-expanded]` on directories) and the tab strip's file/folder chips
 * (`span[data-sidebar-right-tab]`).
 *
 * The fixtures mirror what `ui-sidebar-files` FilesBody/FilesTitle and
 * `ui-sidebar-documentpreview` TextTitle actually render, data attributes
 * included, so the tests pin the anchor contract rather than a CSS-module hash.
 *
 * The overlay NEVER replaces React-managed nodes (that breaks React's DOM
 * bookkeeping): the host svg keeps its position, hidden by the plugin's
 * stylesheet, and our img is inserted beside it.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createIconOverlay } from '../src/client/override.ts'
import type { IconOverlay } from '../src/client/override.ts'

const MARK = 'data-dsh-file-icon-overlay'
const IMG_MARK = 'data-dsh-file-icon-overlay-img'

const NS = 'http://www.w3.org/2000/svg'
/** The viewBox the installed DSH draws its tree rows and chips on. */
const FILE_VIEW_BOX = '0 0 16 16'
/** The 28-unit sheet an older DSH draws folder/traditional types on. */
const GLYPH_VIEW_BOX = '0 0 28 28'
/** A plain chrome glyph (pane controls, and any icon with no file-type mark). */
const UNIT_VIEW_BOX = '0 0 12 12'

/** One host icon: a 16px svg, optionally carrying the file-type marker the
 *  host's `FileTypeIcon` puts inside every sheet it draws. */
function makeIcon(viewBox: string, fileTypeMark = false): SVGSVGElement {
  const svg = document.createElementNS(NS, 'svg')
  svg.setAttribute('width', '16')
  svg.setAttribute('height', '16')
  svg.setAttribute('viewBox', viewBox)
  if (fileTypeMark) {
    const mark = document.createElementNS(NS, 'g')
    mark.setAttribute('data-file-type-mark', 'true')
    svg.appendChild(mark)
  }
  return svg
}

const srcPath = (img: HTMLImageElement | null | undefined): string =>
  img === null || img === undefined ? '' : new URL(img.src).pathname

/** One tree row, exactly as FilesBody's `Entry` renders it. */
function entryRow(kind: 'file' | 'directory' | 'other', name: string, path: string, open = false): HTMLLIElement {
  const li = document.createElement('li')
  li.setAttribute('data-files-entry', kind)
  li.setAttribute('data-files-path', path)
  if (kind === 'other') {
    const span = document.createElement('span')
    span.setAttribute('aria-disabled', 'true')
    span.textContent = name
    li.appendChild(span)
    return li
  }
  const button = document.createElement('button')
  button.type = 'button'
  if (kind === 'directory') {
    button.setAttribute('aria-expanded', String(open))
    button.appendChild(makeIcon(FILE_VIEW_BOX, true))
  } else {
    button.appendChild(makeIcon(FILE_VIEW_BOX, true))
  }
  const label = document.createElement('span')
  label.textContent = name
  button.appendChild(label)
  li.appendChild(button)
  return li
}

/** One tab chip, as `SidebarRight.tsx` renders a `sidebar.right.pane.tab.title`.
 *  The slot renderer wraps the title content in `div[data-slot]`
 *  (`display: contents`), exactly as the live host does. */
function tabChip(tabId: string, label: string, icon: SVGSVGElement | null): HTMLSpanElement {
  const chip = document.createElement('span')
  chip.setAttribute('data-sidebar-right-tab', tabId)
  chip.setAttribute('data-sidebar-right-occurrence', 'o1')
  const slot = document.createElement('div')
  slot.setAttribute('data-slot', 'sidebar.right.pane.tab.title')
  slot.style.display = 'contents'
  if (icon !== null) slot.appendChild(icon)
  slot.appendChild(document.createTextNode(label))
  chip.appendChild(slot)
  return chip
}

/** The pane's guide: entries there draw the same sheets as a chip but are not
 *  tabs, so the overlay must leave them alone. */
function guide(keys: readonly string[]): HTMLDivElement {
  const host = document.createElement('div')
  for (const key of keys) {
    const entry = document.createElement('button')
    entry.setAttribute('data-sidebar-right-guide-entry', key)
    entry.appendChild(makeIcon(UNIT_VIEW_BOX, true))
    entry.appendChild(document.createTextNode(key))
    host.appendChild(entry)
  }
  return host
}

/** Mount the right Sidebar panel: one dock pane holding the tab strip and the
 *  active tab body, the way `ui-sidebar-right` assembles them. */
function mountPanel(chips: HTMLElement[], body: HTMLElement): HTMLElement {
  const panel = document.createElement('div')
  panel.setAttribute('data-sidebar-right-session', 'session-1')
  panel.setAttribute('data-sidebar-right-panel', 'push')
  panel.setAttribute('data-sidebar-right-open', '')
  const pane = document.createElement('div')
  pane.setAttribute('data-dockkit-pane', '')
  pane.setAttribute('data-dockkit-pane-active', '')
  const strip = document.createElement('div')
  for (const chip of chips) strip.appendChild(chip)
  pane.appendChild(strip)
  pane.appendChild(body)
  panel.appendChild(pane)
  document.body.appendChild(panel)
  return pane
}

const ROOT = 'G:\\Program\\personal\\dsh-follow'

/** The `files` tab body: the tab body wrapper the host puts around the pane
 *  root, exactly as `SidebarRight.tsx` keys it. The `files` chip carries the
 *  same `data-sidebar-right-tab`, which is how the overlay links the two. */
const FILES_VIEW_BOX = '0 0 28 28'

function filesBody(tabId = 'tab-files'): HTMLDivElement {
  const root = document.createElement('div')
  root.setAttribute('data-files-state', 'tree')
  root.setAttribute('data-files-root', ROOT)
  const list = document.createElement('ul')
  list.appendChild(entryRow('directory', 'packages', ROOT + '\\packages', true))
  list.appendChild(entryRow('directory', 'src', ROOT + '\\src', false))
  list.appendChild(entryRow('file', 'package.json', ROOT + '\\package.json'))
  list.appendChild(entryRow('file', 'main.ts', ROOT + '\\main.ts'))
  list.appendChild(entryRow('other', 'socket', ROOT + '\\socket'))
  root.appendChild(list)
  const wrapper = document.createElement('div')
  wrapper.setAttribute('data-sidebar-right-tab', tabId)
  wrapper.setAttribute('data-sidebar-right-occurrence', 'o1')
  const body = document.createElement('div')
  body.setAttribute('data-files-body', '')
  body.appendChild(root)
  wrapper.appendChild(body)
  return wrapper
}

/** The files tab's chip, keyed to the body `filesBody()` built. */
function filesChip(tabId = 'tab-files'): HTMLSpanElement {
  return tabChip(tabId, '文件', makeIcon(FILES_VIEW_BOX))
}

const tick = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 10))

/** A document-preview tab body: a pane with no file tree in it. */
function documentPreviewBody(): HTMLDivElement {
  const body = document.createElement('div')
  body.setAttribute('data-textpreview-state', 'text')
  body.setAttribute('data-textpreview-body', '')
  return body
}

/** Every overlay this test started, disposed after it so no observer outlives
 *  the jsdom document and fires into a torn-down environment. */
const live: IconOverlay[] = []

/** Start an overlay and register it for teardown. */
function start(): IconOverlay {
  const overlay = createIconOverlay()
  overlay.start()
  live.push(overlay)
  return overlay
}

/** The overlay img for one host element: a direct child, or the slot wrapper's
 *  child when the title content arrived through a slot. */
const imgIn = (host: Element | null): HTMLImageElement | null => {
  if (host === null) return null
  const marked = (el: Element): el is HTMLImageElement =>
    el instanceof HTMLImageElement && el.hasAttribute(IMG_MARK)
  for (const child of Array.from(host.children)) {
    if (marked(child)) return child
    for (const nested of Array.from(child.children)) if (marked(nested)) return nested
  }
  return null
}

const rowFor = (suffix: string): HTMLElement =>
  document.querySelector<HTMLElement>(`li[data-files-path$="${suffix}"]`)!

beforeEach(() => {
  document.body.innerHTML = ''
  document.head.innerHTML = ''
  document.body.removeAttribute('data-ds-dark-theme')
})

afterEach(() => {
  for (const overlay of live.splice(0)) overlay.dispose()
})

describe('file tree rows', () => {
  it('mirrors a file row with the resolved type icon and hides the host svg', async () => {
    mountPanel([], filesBody())
    start()
    await tick()
    const button = rowFor('package.json').querySelector('button')!
    const img = imgIn(button)
    expect(img).not.toBeNull()
    expect(srcPath(img)).toBe('/dsh-better-sidebar-icons/icons/file_type_npm.svg')
    // The React-managed svg is still in place, hidden by the marker rule.
    const svg = button.querySelector('svg')!
    expect(svg.getAttribute('style')).toBeNull()
    expect(button.hasAttribute(MARK)).toBe(true)
    expect(getComputedStyle(svg).display).toBe('none')
  })

  it('reads each row name from its path, not from the label text', async () => {
    mountPanel([], filesBody())
    start()
    await tick()
    const button = rowFor('main.ts').querySelector('button')
    expect(srcPath(imgIn(button))).toBe('/dsh-better-sidebar-icons/icons/file_type_typescript.svg')
  })

  it('gives directory rows their name-matched closed/open icon from aria-expanded', async () => {
    mountPanel([], filesBody())
    start()
    await tick()
    const open = rowFor('packages').querySelector('button')
    const closed = rowFor('src').querySelector('button')
    expect(srcPath(imgIn(open))).toBe('/dsh-better-sidebar-icons/icons/folder_type_package_opened.svg')
    expect(srcPath(imgIn(closed))).toBe('/dsh-better-sidebar-icons/icons/folder_type_src.svg')
  })

  it('re-resolves a directory that flips open without adding a second img', async () => {
    mountPanel([], filesBody())
    start()
    await tick()
    const button = rowFor('src').querySelector('button')!
    // React commits the expansion: the attribute moves and the glyph is rebuilt.
    button.setAttribute('aria-expanded', 'true')
    button.insertBefore(makeIcon(FILE_VIEW_BOX, true), button.firstChild)
    await tick()
    expect(button.querySelectorAll(`img[${IMG_MARK}]`).length).toBe(1)
    expect(srcPath(imgIn(button))).toBe('/dsh-better-sidebar-icons/icons/folder_type_src_opened.svg')
    // Every host svg in the row is hidden: the original and the rebuilt one.
    for (const svg of button.querySelectorAll('svg')) expect(getComputedStyle(svg).display).toBe('none')
  })

  it('leaves entry rows the host draws no icon for alone', async () => {
    mountPanel([], filesBody())
    start()
    await tick()
    const other = document.querySelector('li[data-files-entry="other"]')!
    expect(imgIn(other)).toBeNull()
    expect(other.hasAttribute(MARK)).toBe(false)
  })

  it('overlays rows that mount after start (async sidebar)', async () => {
    start()
    await tick()
    expect(document.querySelector(`img[${IMG_MARK}]`)).toBeNull()
    mountPanel([], filesBody())
    await tick()
    // Four overlayable rows: two directories and two files. The `other` row
    // draws no host icon, and the tree header is a full path, not a row.
    expect(document.querySelectorAll(`img[${IMG_MARK}]`).length).toBe(4)
  })
})

describe('tab strip chips', () => {
  it('gives the files chip the workspace folder icon named by the tree root', async () => {
    const chip = filesChip()
    mountPanel([chip], filesBody())
    start()
    await tick()
    // A folder with no folderNames entry takes the theme's default folder icon.
    expect(srcPath(imgIn(chip))).toBe('/dsh-better-sidebar-icons/icons/default_folder.svg')
    expect(chip.hasAttribute(MARK)).toBe(true)
    expect(getComputedStyle(chip.querySelector('svg')!).display).toBe('none')
  })

  it('resolves the files chip by name when the workspace folder is themed', async () => {
    const chip = filesChip()
    mountPanel([chip], filesBody())
    document.querySelector('[data-files-root]')!.setAttribute('data-files-root', ROOT + '\\packages')
    start()
    await tick()
    expect(srcPath(imgIn(chip))).toBe('/dsh-better-sidebar-icons/icons/folder_type_package.svg')
  })

  it('gives a document chip the icon its own label classifies to', async () => {
    const chip = tabChip('doc-1', 'package.json', makeIcon(FILE_VIEW_BOX))
    mountPanel([chip], documentPreviewBody())
    start()
    await tick()
    expect(srcPath(imgIn(document.querySelector('span[data-sidebar-right-tab="doc-1"]')))).toBe('/dsh-better-sidebar-icons/icons/file_type_npm.svg')
  })

  it('resolves a document chip in the files pane from its label, not the tree root', async () => {
    const chips = [filesChip(), tabChip('doc-1', 'package.json', makeIcon(FILE_VIEW_BOX))]
    mountPanel(chips, filesBody())
    start()
    await tick()
    expect(srcPath(imgIn(chips[1]!))).toBe('/dsh-better-sidebar-icons/icons/file_type_npm.svg')
  })

  it('leaves a chrome chip whose glyph is a unit icon untouched', async () => {
    const chip = tabChip('plan-1', 'notes.md', makeIcon(UNIT_VIEW_BOX))
    mountPanel([chip], filesBody())
    start()
    await tick()
    expect(imgIn(chip)).toBeNull()
    expect(chip.hasAttribute(MARK)).toBe(false)
  })

  it('accepts a 28-unit sheet from an older host as a chip icon', async () => {
    const chip = tabChip('tab-files', '文件', makeIcon(GLYPH_VIEW_BOX))
    mountPanel([chip], filesBody())
    start()
    await tick()
    expect(srcPath(imgIn(chip))).toBe('/dsh-better-sidebar-icons/icons/default_folder.svg')
  })

  it('keeps the files chip on the workspace folder after the tree unmounts', async () => {
    const chip = filesChip()
    mountPanel([chip], filesBody())
    start()
    await tick()
    expect(srcPath(imgIn(chip))).toBe('/dsh-better-sidebar-icons/icons/default_folder.svg')
    // Switching to another tab unmounts the tree but keeps the chip.
    document.querySelector('[data-files-body]')!.remove()
    document.body.appendChild(document.createElement('div'))
    await tick()
    expect(srcPath(imgIn(chip))).toBe('/dsh-better-sidebar-icons/icons/default_folder.svg')
  })

  it('leaves guide entries alone (they draw a sheet but are not tabs)', async () => {
    const pane = mountPanel([], filesBody())
    pane.insertBefore(guide(['files', 'git']), pane.firstChild)
    start()
    await tick()
    const entries = document.querySelectorAll('[data-sidebar-right-guide-entry]')
    expect(entries.length).toBe(2)
    for (const entry of entries) {
      expect(imgIn(entry)).toBeNull()
      expect(entry.hasAttribute(MARK)).toBe(false)
    }
  })
})

describe('scheme and teardown', () => {
  it('flips every icon to its light variant on a scheme change', async () => {
    const chip = tabChip('doc-1', 'hello.ada', makeIcon(FILE_VIEW_BOX))
    mountPanel([chip], documentPreviewBody())
    start()
    await tick()
    const img = imgIn(document.querySelector('span[data-sidebar-right-tab="doc-1"]'))
    // Body has no data-ds-dark-theme: the light theme's variant is in force.
    expect(srcPath(img)).toBe('/dsh-better-sidebar-icons/icons/file_type_light_ada.svg')
    document.body.setAttribute('data-ds-dark-theme', '')
    await tick()
    expect(srcPath(img)).toBe('/dsh-better-sidebar-icons/icons/file_type_ada.svg')
  })

  it('drops the overlay of a row React removed from the document', async () => {
    mountPanel([], filesBody())
    start()
    await tick()
    const li = rowFor('main.ts')
    const button = li.querySelector('button')!
    expect(imgIn(button)).not.toBeNull()
    li.remove()
    // Any later mutation makes the scanner drop the detached host's overlay.
    document.body.appendChild(document.createElement('div'))
    await tick()
    expect(imgIn(button)).toBeNull()
    expect(button.hasAttribute(MARK)).toBe(false)
  })

  it('restores every touched element and removes its stylesheet on dispose', async () => {
    const chip = tabChip('@deepseek-ai/dsh-client-ui-sidebar-files', 'files', makeIcon(FILE_VIEW_BOX, true))
    mountPanel([chip], filesBody())
    const overlay = start()
    await tick()
    // Four tree rows plus the files chip.
    expect(document.querySelectorAll(`img[${IMG_MARK}]`).length).toBe(5)
    overlay.dispose()
    live.length = 0
    expect(document.querySelector(`img[${IMG_MARK}]`)).toBeNull()
    expect(document.querySelector(`[${MARK}]`)).toBeNull()
    expect(document.head.querySelector('style')).toBeNull()
    for (const svg of document.querySelectorAll('svg')) expect(getComputedStyle(svg).display).not.toBe('none')
  })
})
