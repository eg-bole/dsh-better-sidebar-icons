/**
 * The service half of the theme: replace the explorer's file and folder icons
 * through the `registerFileIcon` contract of the `dsh-better-sidebar` service
 * (`ctx.betterSidebar`, feature `'fileIcons'`, v0.19.1+).
 *
 * Why this beats the DOM overlay in {@link ./override.ts}: the service hands
 * the theme the ROW ITSELF — a path, a pixel size and a directory's expansion
 * state — so resolution is exact instead of reconstructed from row text, and
 * the host renders the ReactNode itself (no shadowing of a host `<svg>`, no
 * `MutationObserver`, no injected stylesheet). The overlay stays as the
 * fallback for a host WITHOUT the service: DSH's own
 * `@deepseek-ai/dsh-client-ui-sidebar-files` explorer.
 *
 * The service resolves, per file row, `names` → `exts` → the `exts: []`
 * catch-all, and only then its own built-in glyph map; per directory row,
 * `folderNames` → `'folder'`/`'folder-open'` → its built-in. Registering a
 * complete theme therefore needs exactly three descriptors, and no
 * registration can leak into another plugin's rows:
 *
 * - file names  — every exact basename the theme knows (`package.json`, …)
 * - file exts   — the global default: claims whatever the other two miss
 * - folder      — named folders, plus the closed/open directory glyphs
 *
 * `path` and `size` are what the HOST passes (a full path and 14px today); the
 * factory still takes the basename so a bare name would resolve too.
 */
import { baseName, iconUrl, resolveFileIcon, resolveFolderIcon } from './resolve-icon.ts'
import { ICON_THEME } from './icons-manifest.generated.ts'
import { isDarkScheme, subscribeScheme } from './scheme.ts'

/** The `dsh-better-sidebar` file-icon descriptor this adapter registers
 *  (structural mirror of the `FileIconDescriptor` contract — the plugin
 *  declares no dependency on that package, so the types stay local). */
export interface FileIconDescriptor {
  id: string
  exts?: readonly string[]
  names?: readonly string[]
  folderNames?: readonly string[]
  priority?: number
  icon: (path: string, size: number, open?: boolean) => unknown
}

/** The slice of the `ctx.betterSidebar` service face this adapter uses. */
export interface FileIconService {
  readonly features?: readonly string[]
  registerFileIcon: (descriptor: FileIconDescriptor) => () => void
}

/** One React face, injected so this module carries no runtime import of it. */
export interface ServiceIconReact {
  createElement: (type: unknown, props: Record<string, unknown> | null) => unknown
  useSyncExternalStore: <T>(subscribe: (onChange: () => void) => () => void, getSnapshot: () => T) => T
}

/** Descriptor ids, namespaced so a re-mount replaces rather than clashes. */
export const FILE_NAMES_ID = 'dsh-better-sidebar-icons:file-names'
export const FILE_EXTS_ID = 'dsh-better-sidebar-icons:file-exts'
export const FOLDER_ID = 'dsh-better-sidebar-icons:folder'

/** The `data-*` marker stamped on every themed `<img>`, so the plugin (and a
 *  visual check) can tell its own render apart from the host's glyphs. */
export const SERVICE_ICON_ATTR = 'data-dsh-file-icon-service-img'

/** The tree rows and chips render at 14px; anything smaller is a host bug. */
const MIN_SIZE = 1

/** Every exact basename the theme colours, as the service's `names` list. */
function themedFileNames(): string[] {
  return Object.keys(ICON_THEME.fileNames)
}

/** Every exact directory basename the theme colours, as `folderNames`. */
function themedFolderNames(): string[] {
  return Object.keys(ICON_THEME.folderNames)
}

/**
 * Build the descriptors for one theme.
 *
 * `exts: []` is the documented global default: it claims what the `names` and
 * `exts` descriptors miss, which for this theme is every file — the theme has
 * its own `defaults.file` fallback and should not mix a host glyph into the
 * tree.
 */
export function descriptors(iconOf: FileIconDescriptor['icon']): FileIconDescriptor[] {
  const names = themedFileNames()
  return [
    { id: FILE_NAMES_ID, names, priority: 10, icon: iconOf },
    // The folder descriptor carries both halves: a named folder resolves by
    // name, every other directory by the reserved closed/open extension. Name
    // matches outrank them in the service, so one descriptor is enough.
    { id: FOLDER_ID, folderNames: themedFolderNames(), exts: ['folder', 'folder-open'], priority: 10, icon: iconOf },
    { id: FILE_EXTS_ID, exts: [], priority: 0, icon: iconOf },
  ]
}

/**
 * Create the icon factory the descriptors share: a path (plus size and a
 * directory's expansion state) resolves to an `<img>` of the theme's SVG.
 *
 * The element subscribes to the color scheme on its own, so a dark/light flip
 * RE-RESOLVES in place. That subscription cannot live in the factory: the host
 * only calls the factory while rendering, and it does not know a scheme change
 * happened, so nothing would re-render a plain element.
 */
export function createIconFactory(react: ServiceIconReact): FileIconDescriptor['icon'] {
  const { createElement, useSyncExternalStore } = react

  /** One themed icon, resolved on every render and on every scheme flip. */
  const ThemedIcon = (props: { file: string; size: number }): unknown => {
    const { file, size } = props
    // `isDarkScheme`/`subscribeScheme` read the app's live theme attribute.
    const dark = useSyncExternalStore(subscribeScheme, isDarkScheme)
    return createElement('img', {
      src: iconUrl(file),
      width: size,
      height: size,
      alt: '',
      draggable: false,
      [SERVICE_ICON_ATTR]: '',
      style: { display: 'block', flex: 'none' },
      // `alt=""` is not enough for a glyph that repeats the row's own label.
      'aria-hidden': 'true',
      // The scheme is a render input even though it reaches no attribute: the
      // element identity changes with it, which is exactly the re-render.
      'data-dsh-file-icon-scheme': dark ? 'dark' : 'light',
    })
  }

  return (path, size, open) => {
    const name = baseName(path)
    const wanted = size > MIN_SIZE - 1 ? size : MIN_SIZE
    // A row with no basename (a bare root) still gets the default glyph.
    const isDirectory = open !== undefined
    const file = name === ''
      ? (isDirectory ? ICON_THEME.defaults.folder : ICON_THEME.defaults.file)
      : isDirectory
        ? resolveFolderIcon(name, open, isDarkScheme())
        : resolveFileIcon(name, isDarkScheme())
    return createElement(ThemedIcon, { file, size: wanted })
  }
}

/**
 * Whether this host can take the service path: the better-sidebar service
 * holds the `fileIcons` feature AND still exposes `registerFileIcon`.
 *
 * A host without better-sidebar, or an older one, fails both probes and the
 * caller keeps the DOM overlay instead.
 */
export function supportsFileIcons(service: unknown): service is FileIconService {
  if (service === null || typeof service !== 'object') return false
  const candidate = service as Partial<FileIconService>
  if (typeof candidate.registerFileIcon !== 'function') return false
  // The feature list is the contract's own gate; absent (a pre-0.12 host) the
  // function probe above is the whole answer.
  if (candidate.features === undefined) return true
  return candidate.features.includes('fileIcons')
}

/**
 * Register the theme with the service for the caller's lifetime.
 *
 * @param service - the host's `betterSidebar` service face.
 * @param react - the host's React face (from the module-loader seed word).
 * @returns the disposal that unregisters all three descriptors, or `undefined`
 *   when the host cannot take the service path (the caller falls back).
 */
export function registerServiceIcons(
  service: unknown,
  react: ServiceIconReact,
): (() => void) | undefined {
  if (!supportsFileIcons(service)) return undefined
  const disposers = descriptors(createIconFactory(react)).map(descriptor => service.registerFileIcon(descriptor))
  return () => {
    // Reverse order: the catch-all goes last so no row is briefly unthemed
    // while the specific descriptors are still live.
    for (const dispose of disposers.reverse()) dispose()
  }
}
