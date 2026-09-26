/**
 * The DOM overlay: the vscode-icons theme images drawn beside the DSH file
 * explorer's own icons: the right Sidebar's `files` tab tree rows, and the
 * file/folder chips in the right Sidebar's tab strip.
 *
 * Anchor contract (the host's own stable hooks, never CSS-module hashes):
 * `@deepseek-ai/dsh-client-ui-sidebar-files` renders the tree as
 * `[data-files-state="tree"][data-files-root]` holding
 * `li[data-files-entry][data-files-path]`, one `li` per entry, whose
 * `button[aria-expanded]` says whether a directory is open. Tab chips are
 * `span[data-sidebar-right-tab]` (ui-sidebar-right `SidebarRight.tsx`), whose
 * slot content is a `<FileTypeIcon/>` followed by the tab's label text.
 *
 * The tree's root is the pane header's full-path `PathLabel`, not a folder row,
 * so it keeps the host's presentation: overlaying it would replace a path with a
 * leaf name. The `files` chip takes the root's leaf name instead, remembered per
 * tab while the tree is on screen (switching tabs unmounts the tree and remounts
 * the pane, so the root is gone from the DOM exactly when the chip still needs
 * it).
 *
 * CRITICAL, never replace React-managed nodes: the host renders these icons as
 * controlled React elements, and swapping them out breaks React's DOM
 * bookkeeping (its fiber tree still points at the old svg; the next commit
 * calls removeChild on a detached node and the tree blows up). Instead the
 * element that owns the host icon gets a marker attribute and the original svg
 * stays IN PLACE, hidden by the plugin's own stylesheet
 * (`[data-dsh-file-icon-overlay] > svg` with `!important`); our `<img>` is
 * inserted beside it. React can update and remove its node freely, and a
 * rebuilt svg inside a still-marked element is hidden by the same rule without a
 * rescan.
 *
 * Everything is restored on dispose (hot reload / disable). Scheme flips
 * (`body[data-ds-dark-theme]`) re-resolve in place.
 */
import { ICON_THEME } from './icons-manifest.generated.ts'
import { baseName, iconUrl, resolveFileIcon, resolveFolderIcon } from './resolve-icon.ts'
import { isDarkScheme, subscribeScheme } from './scheme.ts'

/** Marker attribute on the host element whose icon we replaced. */
const MARK = 'data-dsh-file-icon-overlay'

/** Marker attribute on our overlay <img> elements (own-node detection). */
const IMG_MARK = 'data-dsh-file-icon-overlay-img'

/** Structural marker the host's `FileTypeIcon` puts inside every file/folder
 *  sheet it draws (`ui-primitives` FileTypeIcon `data-file-type-mark`). Its
 *  presence is what distinguishes a themed file icon from the chrome glyphs the
 *  guide and the pane controls draw. */
const FILE_ICON_MARK = '[data-file-type-mark]'

/** The `FileTypeIcon` viewBoxes seen across DSH releases: 28 units for the
 *  folder/traditional sheets, 20 for the code-file sheet, and 16 for the
 *  outline family the tree and chips ship today. */
const FILE_ICON_VIEW_BOXES = ['0 0 28 28', '0 0 20 20', '0 0 16 16']

/** A nav or guide element: it draws tab-type glyphs inside the guide list, not
 *  a tab chip, so it never carries a chip overlay. */
const GUIDE_SELECTOR = '[data-sidebar-right-guide-entry]'

/** Fallback icon size per surface, used when the host svg carries no width. */
const ROW_ICON_SIZE = 16
const TAB_ICON_SIZE = 16

/** How a marked element's icon resolves: a file name, or a folder that has an
 *  open and a closed variant. */
type Kind = 'file' | 'folder'

interface Overlaid {
  host: HTMLElement
  img: HTMLImageElement
  kind: Kind
  /** Basename (or tab label) the icon was resolved from. */
  name: string
  /** Expanded state: folders only. */
  open: boolean
  /** The icon file the img currently shows. */
  file: string
}

/** The stylesheet rule that hides host icons inside a marked element. The
 *  marker attribute is a fine-scoped selector (never a bare `svg`), and
 *  `!important` beats any inline style the host may re-apply. The slot renderer
 *  wraps content in `div[data-slot]` (`display: contents`), so the icon is not
 *  always a direct child: the list covers the nesting the host produces. */
const HIDE_RULE = [
  `[${MARK}] > svg`,
  `[${MARK}] > span > svg`,
  `[${MARK}] > div > svg`,
  `[${MARK}] > span > div > svg`,
].join(',\n') + ' { display: none !important; }'

/** The host icon a marked candidate draws, or null. Slot content arrives
 *  wrapped (`div[data-slot]`, sometimes a `span`), so the first svg within a
 *  couple of element levels is the icon. */
function hostIconOf(host: Element): SVGElement | null {
  const direct = host.querySelector(':scope > svg')
  if (direct !== null) return direct as SVGElement
  for (const child of Array.from(host.children)) {
    const nested = child.querySelector(':scope > svg') ?? child.querySelector(':scope > * > svg')
    if (nested !== null) return nested as SVGElement
  }
  return null
}

function resolveIcon(kind: Kind, name: string, open: boolean, light: boolean): string {
  return kind === 'file' ? resolveFileIcon(name, light) : resolveFolderIcon(name, open, light)
}

/** The rendered size of one host icon (falls back to the surface default). */
function sizeOf(icon: Element, fallback: number): number {
  const width = Number(icon.getAttribute('width'))
  return Number.isFinite(width) && width > 0 ? width : fallback
}

export interface IconOverlay {
  /** Begin watching for host mounts and start overlaying. */
  start(): void
  /** Restore every touched element and stop watching. */
  dispose(): void
}

export function createIconOverlay(): IconOverlay {
  let disposed = false
  const overlays = new Map<HTMLImageElement, Overlaid>()
  /** The workspace folder name behind each `files` tab, keyed by that tab's id.
   *  The tree unmounts when another tab takes the pane (and the pane itself is
   *  remounted), so the chip that survives cannot read the root from the DOM at
   *  that moment; it is remembered while the tree is on screen instead. */
  const folderNameByFilesTab = new Map<string, string>()
  let observer: MutationObserver | undefined
  let disposeScheme: (() => void) | undefined
  const style = document.createElement('style')
  style.textContent = HIDE_RULE

  /** Point one overlay at the icon its current facts resolve to. */
  const applyIcon = (o: Overlaid): void => {
    const file = resolveIcon(o.kind, o.name, o.open, !isDarkScheme())
    if (file === o.file) return
    o.file = file
    o.img.src = iconUrl(file)
  }

  const refresh = (): void => {
    if (disposed) return
    for (const o of overlays.values()) applyIcon(o)
  }

  /** Our img for a host element, alive in the document. It sits beside the host
   *  icon, which the slot wrapper can place one level deep. */
  const ownImg = (host: HTMLElement): HTMLImageElement | null => {
    for (const child of Array.from(host.children)) {
      if (child instanceof HTMLImageElement && child.hasAttribute(IMG_MARK)) return child
      for (const nested of Array.from(child.children)) {
        if (nested instanceof HTMLImageElement && nested.hasAttribute(IMG_MARK)) return nested
      }
    }
    return null
  }

  /** Undo one host element: drop the marker and our img. */
  const restore = (o: Overlaid): void => {
    o.host.removeAttribute(MARK)
    o.img.remove()
    overlays.delete(o.img)
  }

  /**
   * Overlay one host element, or re-assert an existing overlay.
   * @param host - the element owning the host icon (row button or tab chip).
   * @param icon - the host svg to mirror (its size is reused).
   * @param kind - whether the name resolves as a file or as a folder.
   * @param name - the basename (or tab label) to resolve.
   * @param open - expanded state, for folders.
   * @param fallbackSize - icon size when the host svg carries none.
   */
  const overlay = (
    host: HTMLElement,
    icon: Element,
    kind: Kind,
    name: string,
    open: boolean,
    fallbackSize: number,
  ): void => {
    const existing = ownImg(host)
    if (existing !== null) {
      // React rebuilt this element's children: the marker can be dropped in the
      // process, and a directory row can flip open/closed under a stable host,
      // so re-assert the marker and re-resolve the icon from the current facts.
      host.setAttribute(MARK, '')
      const record = overlays.get(existing)
      if (record !== undefined) {
        record.name = name
        record.open = open
        applyIcon(record)
      }
      return
    }
    const size = sizeOf(icon, fallbackSize)
    const img = document.createElement('img')
    img.alt = ''
    img.draggable = false
    img.width = size
    img.height = size
    img.style.flexShrink = '0'
    img.setAttribute(IMG_MARK, '1')
    host.setAttribute(MARK, '')
    // Sit beside the host icon wherever the slot wrapper put it, so both occupy
    // the same flow position.
    const parent = icon.parentElement ?? host
    if (icon.nextSibling === null) parent.appendChild(img)
    else parent.insertBefore(img, icon.nextSibling)
    const record: Overlaid = { host, img, kind, name, open, file: '' }
    overlays.set(img, record)
    applyIcon(record)
  }

  /** One tree entry row: `li[data-files-entry][data-files-path]`. */
  const handleEntry = (li: HTMLElement): void => {
    const kind = li.getAttribute('data-files-entry')
    // Neither a file nor a directory: the host draws no icon at all.
    if (kind !== 'file' && kind !== 'directory') return
    const row = li.querySelector<HTMLElement>(':scope > button')
    const icon = row === null ? null : hostIconOf(row)
    if (row === null || icon === null) return
    const name = baseName(li.getAttribute('data-files-path') ?? '')
    if (name === '') return
    if (kind === 'file') {
      overlay(row, icon, 'file', name, false, ROW_ICON_SIZE)
      return
    }
    overlay(row, icon, 'folder', name, row.getAttribute('aria-expanded') === 'true', ROW_ICON_SIZE)
  }

  /** One right-Sidebar tab chip: a host file icon plus the tab's own label. The
   *  `files` chip is the workspace folder, so it takes the tree root's name. */
  const handleTab = (chip: HTMLElement): void => {
    // Guide entries draw the same sheets as a chip but are not tabs.
    if (chip.closest(GUIDE_SELECTOR) !== null) return
    const icon = hostIconOf(chip)
    if (icon === null) return
    // A themed file icon either carries the host's file-type marker or draws on
    // a file-icon viewBox; a chrome glyph does neither.
    const viewBox = icon.getAttribute('viewBox') ?? ''
    if (icon.querySelector(FILE_ICON_MARK) === null && !FILE_ICON_VIEW_BOXES.includes(viewBox)) return
    const label = (chip.textContent ?? '').trim()
    if (label === '') return
    const tabId = chip.getAttribute('data-sidebar-right-tab') ?? ''
    const name = folderNameByFilesTab.get(tabId)
    if (name !== undefined) {
      // The closed variant: expansion belongs to the pane's body, not the chip.
      overlay(chip, icon, 'folder', name, false, TAB_ICON_SIZE)
      return
    }
    // A file chip: the label is exactly what the host classified.
    overlay(chip, icon, 'file', label, false, TAB_ICON_SIZE)
  }

  /** One pass over every host surface. Errors are contained per surface so a
   *  throw can never escape into the observer callback, which would poison the
   *  page. */
  const scan = (): void => {
    if (disposed) return
    // Pass one: drop overlays whose host left the document. React removing a row
    // or unmounting a tab must not leave bookkeeping (or scheme refreshes)
    // behind for a detached element.
    for (const o of [...overlays.values()]) {
      if (!o.host.isConnected) restore(o)
    }
    // Pass two: remember the workspace folder name behind each open tree, keyed
    // by its tab, so the `files` chip still names the folder after another tab
    // takes the pane and the tree unmounts.
    for (const root of document.querySelectorAll<HTMLElement>('[data-files-root]')) {
      const name = baseName(root.getAttribute('data-files-root') ?? '')
      const tabId = root.closest('[data-sidebar-right-tab]')?.getAttribute('data-sidebar-right-tab') ?? ''
      if (name !== '' && tabId !== '') folderNameByFilesTab.set(tabId, name)
    }
    // Forget entries whose tab no longer exists, so a closed tab's id cannot
    // come back as a stale name.
    const liveTabs = new Set(Array.from(document.querySelectorAll('[data-sidebar-right-tab]'))
      .map(el => el.getAttribute('data-sidebar-right-tab') ?? ''))
    for (const tabId of [...folderNameByFilesTab.keys()]) {
      if (!liveTabs.has(tabId)) folderNameByFilesTab.delete(tabId)
    }
    // Pass three: the tree rows.
    for (const li of document.querySelectorAll<HTMLElement>('[data-files-entry]')) {
      try {
        handleEntry(li)
      } catch { /* a row overlay failure skips that row only */ }
    }
    // Pass four: the tab-strip chips.
    for (const chip of document.querySelectorAll<HTMLElement>('span[data-sidebar-right-tab]')) {
      try {
        handleTab(chip)
      } catch { /* a chip overlay failure skips that chip only */ }
    }
  }
  return {
    start() {
      document.head.appendChild(style)
      observer = new MutationObserver(scan)
      observer.observe(document.body, { childList: true, subtree: true })
      disposeScheme = subscribeScheme(refresh)
      scan()
    },
    dispose() {
      disposed = true
      observer?.disconnect()
      observer = undefined
      disposeScheme?.()
      disposeScheme = undefined
      for (const o of [...overlays.values()]) restore(o)
      overlays.clear()
      folderNameByFilesTab.clear()
      style.remove()
    },
  }
}

// Re-export for tests/tools: keep the basename helper reachable.
export { baseName, ICON_THEME }
