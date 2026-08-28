/**
 * The DOM overlay: swaps the better-sidebar explorer row icons (react-icons
 * VscFile / VscFolder / VscFolderOpened) and the editor-tab icons for the
 * vscode-icons theme images served by the plugin route.
 *
 * Row anchoring — the core renders file rows with `title={entry.path}`
 * (folders have no title) and every row carries a `.explorerName` label
 * span; the CSS Modules pattern `[hash]_[local]` keeps the local name in
 * the class, so `[class*="explorerName"]` is a stable, hash-free anchor.
 * Tab anchoring — every tab carries a `.tabTitle` label span; the icon is
 * the first svg before it. A tab is treated as a file tab when its title
 * resolves to a non-default icon (built-in tabs like Git/Terminal resolve
 * to the default and are left alone).
 *
 * React re-renders rows/tabs on state changes (expand/collapse, refresh,
 * focus, open/close), so a MutationObserver keeps scanning the mounted
 * [data-dsh-better-sidebar] subtree and re-applies; every touched element
 * is restored on dispose (hot reload / disable). Scheme flips
 * (body[data-ds-dark-theme]) re-resolve in place.
 */
import { ICON_THEME } from './icons-manifest.generated.ts'
import { baseName, iconUrl, resolveFileIcon, resolveFolderIcon } from './resolve-icon.ts'
import { isDarkScheme, subscribeScheme } from './scheme.ts'

/** Marker attribute on overlay <img> elements (own-row detection). */
const MARK = 'data-dsh-better-sidebar-icons'

/** react-icons VscFolderOpened path `d` prefix (the closed folder glyph
 *  diverges in the first command; VscFile never starts with this). */
const FOLDER_OPEN_D = 'M2 4.5V9.10022L2.92389'

/** The row icon size the core renders (VscFile/VscFolder at size={14}). */
const ROW_ICON_SIZE = 14

type RowKind = 'file' | 'folder' | 'root' | 'tab'

interface Overlaid {
  img: HTMLImageElement
  orig: SVGElement
  kind: RowKind
  name: string
  open: boolean
}

function resolve(kind: RowKind, name: string, open: boolean, light: boolean): string {
  if (kind === 'file' || kind === 'tab') return resolveFileIcon(name, light)
  if (kind === 'folder') return resolveFolderIcon(name, open, light)
  return open ? ICON_THEME.defaults.rootFolderOpen : ICON_THEME.defaults.rootFolder
}

/** The rendered size of one svg icon (falls back to the row size). */
function sizeOf(icon: SVGElement, fallback: number): number {
  const width = Number(icon.getAttribute('width'))
  return Number.isFinite(width) && width > 0 ? width : fallback
}

function makeImg(file: string, size: number): HTMLImageElement {
  const img = document.createElement('img')
  img.src = iconUrl(file)
  img.alt = ''
  img.draggable = false
  img.width = size
  img.height = size
  img.style.flexShrink = '0'
  img.setAttribute(MARK, '1')
  return img
}

export interface IconOverlay {
  /** Begin watching for the host mount and start overlaying. */
  start(): void
  /** Restore every touched element and stop watching. */
  dispose(): void
}

export function createIconOverlay(): IconOverlay {
  let disposed = false
  const overlays = new Map<HTMLImageElement, Overlaid>()
  let observer: MutationObserver | undefined
  let bodyObserver: MutationObserver | undefined
  let disposeScheme: (() => void) | undefined

  const refresh = (): void => {
    if (disposed) return
    const light = !isDarkScheme()
    for (const [img, o] of overlays) img.src = iconUrl(resolve(o.kind, o.name, o.open, light))
  }

  /** Drop a stale overlay img this element no longer contains (React
   *  re-rendered and restored its svg). */
  const dropStale = (el: Element): void => {
    const stale = el.querySelector<HTMLElement>(`[${MARK}]`)
    if (stale !== null) {
      overlays.delete(stale as HTMLImageElement)
      stale.remove()
    }
  }

  const overlay = (row: HTMLElement, iconEl: SVGElement, kind: RowKind, name: string, open: boolean): void => {
    dropStale(row)
    const img = makeImg(resolve(kind, name, open, !isDarkScheme()), sizeOf(iconEl, ROW_ICON_SIZE))
    row.replaceChild(img, iconEl)
    overlays.set(img, { img, orig: iconEl, kind, name, open })
  }

  /** One file-tree row: anchor on its explorerName label. */
  const handleRow = (row: HTMLElement): void => {
    const iconEl = row.firstElementChild
    if (!(iconEl instanceof SVGElement)) return
    if (iconEl.hasAttribute(MARK)) return
    const nameEl = row.querySelector<HTMLElement>('[class*="explorerName"]')
    const name = (nameEl?.textContent ?? '').trim()
    if (name === '') return
    if (row.hasAttribute('title')) {
      // File row.
      overlay(row, iconEl, 'file', name, false)
      return
    }
    const d = iconEl.querySelector('path')?.getAttribute('d') ?? ''
    const open = d.startsWith(FOLDER_OPEN_D)
    // The tree root row has no role="button" (folder rows do).
    const kind: RowKind = row.hasAttribute('role') ? 'folder' : 'root'
    overlay(row, iconEl, kind, name, open)
  }

  /** One tab: anchor on its tabTitle label; the icon is the first svg
   *  before it. Only file tabs (title resolves to a non-default icon) are
   *  overlaid — built-in tabs resolve to the default and stay untouched. */
  const handleTab = (tab: HTMLElement, titleSpan: HTMLElement): void => {
    let icon: SVGElement | null = null
    for (let el = titleSpan.previousElementSibling; el !== null; el = el.previousElementSibling) {
      if (el instanceof SVGElement) {
        icon = el
        break
      }
      if (el.hasAttribute(MARK)) return // already overlaid
    }
    if (icon === null || icon.hasAttribute(MARK)) return
    const name = (titleSpan.textContent ?? '').trim()
    if (name === '') return
    // Only recognizable files: built-in tab titles resolve to the default.
    if (resolveFileIcon(baseName(name), !isDarkScheme()) === ICON_THEME.defaults.file) return
    overlay(tab, icon, 'tab', name, false)
  }

  const scan = (): void => {
    if (disposed) return
    const host = document.querySelector('[data-dsh-better-sidebar]')
    if (host === null) return
    for (const el of host.querySelectorAll<HTMLElement>('[role="button"], [class*="explorerRow"]')) {
      if (el.querySelector('[class*="explorerName"]') !== null) handleRow(el)
    }
    for (const span of host.querySelectorAll<HTMLElement>('[class*="tabTitle"]')) {
      const tab = span.parentElement
      if (tab !== null) handleTab(tab, span)
    }
  }

  const attach = (host: Element): void => {
    observer = new MutationObserver(scan)
    observer.observe(host, { childList: true, subtree: true })
    disposeScheme = subscribeScheme(refresh)
    scan()
  }

  return {
    start() {
      const host = document.querySelector('[data-dsh-better-sidebar]')
      if (host !== null) {
        attach(host)
        return
      }
      // Host not mounted yet: watch the body until the sidebar appears.
      bodyObserver = new MutationObserver(() => {
        const found = document.querySelector('[data-dsh-better-sidebar]')
        if (found === null) return
        bodyObserver?.disconnect()
        bodyObserver = undefined
        attach(found)
      })
      bodyObserver.observe(document.body, { childList: true, subtree: true })
    },
    dispose() {
      disposed = true
      observer?.disconnect()
      observer = undefined
      bodyObserver?.disconnect()
      bodyObserver = undefined
      disposeScheme?.()
      disposeScheme = undefined
      for (const [img, o] of overlays) img.parentElement?.replaceChild(o.orig, img)
      overlays.clear()
    },
  }
}

// Re-export for tests/tools: keep the basename helper reachable.
export { baseName }
