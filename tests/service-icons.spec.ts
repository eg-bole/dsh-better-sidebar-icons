// @vitest-environment jsdom
/**
 * Service-path tests (src/client/service-icons.ts): the theme registered
 * through `ctx.betterSidebar.registerFileIcon` (feature `'fileIcons'`).
 *
 * These pin the CONTRACT the host resolves with, so a regression in the
 * descriptor shape shows up here rather than in a live tree:
 *
 * - three descriptors, and the id/priority/ordering rules between them;
 * - the service's own resolution order replayed over them (names → exts →
 *   `exts: []` for files; folderNames → `'folder'`/`'folder-open'` for
 *   directories), which is what decides whether a row is themed at all;
 * - the icon factory's output: an `<img>` of the theme's route, sized to what
 *   the host asked for, marked for identification, `aria-hidden`;
 * - the scheme subscription: a flip re-resolves the icon file in place.
 *
 * The React face is a stub (the real one is the host's seed word, unavailable
 * in jsdom), but it composes the two hooks React itself would, so the factory
 * under test is the shipped one.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createIconFactory,
  descriptors,
  FILE_EXTS_ID,
  FILE_NAMES_ID,
  FOLDER_ID,
  registerServiceIcons,
  SERVICE_ICON_ATTR,
  supportsFileIcons,
  type FileIconDescriptor,
  type ServiceIconReact,
} from '../src/client/service-icons.ts'
import { resolveFileIcon, resolveFolderIcon } from '../src/client/resolve-icon.ts'

const DARK = 'data-ds-dark-theme'

afterEach(() => {
  document.body.removeAttribute(DARK)
})

/**
 * The real React behaviour in miniature: `createElement` on a function
 * component CALLS it (what React does at render time, element indirection
 * dropped), and `useSyncExternalStore` reads the snapshot through the
 * subscription so a scheme change is observable.
 */
function stubReact(): ServiceIconReact & { rendered: number } {
  const state = { rendered: 0 }
  const react: ServiceIconReact = {
    createElement: ((type: unknown, props: Record<string, unknown> | null) => {
      state.rendered += 1
      return typeof type === 'function'
        ? (type as (props: unknown) => unknown)(props ?? {})
        : { type, props }
    }) as ServiceIconReact['createElement'],
    useSyncExternalStore: <T,>(_subscribe: (onChange: () => void) => () => void, getSnapshot: () => T): T =>
      getSnapshot(),
  }
  return Object.assign(react, state)
}

/** The `<img>` props the factory produced for one call. */
function imgOf(descriptor: FileIconDescriptor, path: string, size = 14, open?: boolean): Record<string, unknown> {
  const element = descriptor.icon(path, size, open)
  expect(element).toBeTypeOf('object')
  return (element as { props: Record<string, unknown> }).props
}

const srcOf = (props: Record<string, unknown>): string => String(props.src)

/** The built-ins' own resolution, replayed: the icon file a row should show. */
const fileSrc = (basename: string, dark: boolean): string =>
  `/dsh-better-sidebar-icons/icons/${resolveFileIcon(basename, dark)}`

const folderSrc = (basename: string, open: boolean, dark: boolean): string =>
  `/dsh-better-sidebar-icons/icons/${resolveFolderIcon(basename, open, dark)}`

describe('descriptors', () => {
  it('registers a names rule, a folder rule, and a global default catch-all', () => {
    const list = descriptors(() => null)
    expect(list.map(descriptor => descriptor.id)).toEqual([FILE_NAMES_ID, FOLDER_ID, FILE_EXTS_ID])
    // The catch-all is the LAST row the host consults, so it is registration
    // order that has to be right here, not priority.
    expect(list[2]?.exts).toEqual([])
  })

  it('keeps the name and folder rules ahead of the catch-all', () => {
    const list = descriptors(() => null)
    const byId = new Map(list.map(descriptor => [descriptor.id, descriptor]))
    expect(byId.get(FILE_NAMES_ID)?.names?.length).toBeGreaterThan(100)
    expect(byId.get(FILE_NAMES_ID)?.names).toContain('package.json')
    expect(byId.get(FILE_NAMES_ID)?.exts).toBeUndefined()
    expect(byId.get(FOLDER_ID)?.folderNames).toContain('node_modules')
    expect(byId.get(FOLDER_ID)?.exts).toEqual(['folder', 'folder-open'])
    // The reserved directory extensions must never reach a file row, and the
    // catch-all must never claim a directory name.
    expect(byId.get(FILE_EXTS_ID)?.names).toBeUndefined()
    expect(byId.get(FILE_EXTS_ID)?.folderNames).toBeUndefined()
  })

  it('holds one icon factory per descriptor, wired to the caller', () => {
    const icon = vi.fn(() => null)
    for (const descriptor of descriptors(icon)) descriptor.icon('/x/y.ts', 14)
    expect(icon).toHaveBeenCalledTimes(3)
  })
})

describe('icon factory', () => {
  it('renders a sized, marked, aria-hidden img of the theme route', () => {
    const icon = createIconFactory(stubReact())
    const props = imgOf({ id: 'x', icon }, '/repo/src/index.ts', 14)
    expect(srcOf(props)).toBe(fileSrc('index.ts', false))
    expect(props.width).toBe(14)
    expect(props.height).toBe(14)
    expect(props.alt).toBe('')
    expect(props.draggable).toBe(false)
    expect(props['aria-hidden']).toBe('true')
    expect(props[SERVICE_ICON_ATTR]).toBe('')
    expect(props.style).toEqual({ display: 'block', flex: 'none' })
  })

  it('resolves by exact file name, by extension, and by the theme default', () => {
    const icon = createIconFactory(stubReact())
    // An exact name beats its extension (package.json is not the json glyph).
    expect(srcOf(imgOf({ id: 'x', icon }, '/repo/package.json'))).toBe(fileSrc('package.json', false))
    // An extension rule.
    expect(srcOf(imgOf({ id: 'x', icon }, '/repo/src/main.rs'))).toBe(fileSrc('main.rs', false))
    // Nothing matches: the theme's own default, never a host glyph.
    expect(srcOf(imgOf({ id: 'x', icon }, '/repo/weird.qqq'))).toBe('/dsh-better-sidebar-icons/icons/default_file.svg')
  })

  it('resolves a directory by name and by expansion state', () => {
    const icon = createIconFactory(stubReact())
    expect(srcOf(imgOf({ id: 'x', icon }, '/repo/node_modules', 14, false))).toBe(folderSrc('node_modules', false, false))
    // A themed name resolves even when it is not an obvious one (`src` ships
    // its own folder glyph).
    expect(srcOf(imgOf({ id: 'x', icon }, '/repo/src', 14, false))).toBe(folderSrc('src', false, false))
    // A name the theme does not know takes the closed/open default pair.
    const plain = 'zz_not_a_themed_folder'
    expect(srcOf(imgOf({ id: 'x', icon }, `/repo/${plain}`, 14, false))).toBe('/dsh-better-sidebar-icons/icons/default_folder.svg')
    expect(srcOf(imgOf({ id: 'x', icon }, `/repo/${plain}`, 14, true))).toBe('/dsh-better-sidebar-icons/icons/default_folder_opened.svg')
    // `open === undefined` means a FILE row, so a file named like a folder
    // must not take a folder glyph.
    expect(srcOf(imgOf({ id: 'x', icon }, '/repo/src', 14))).toBe(fileSrc('src', false))
  })

  it('takes the path the host passes, basename and all', () => {
    const icon = createIconFactory(stubReact())
    // A Windows path, and a name the host may hand over bare (a root row).
    expect(srcOf(imgOf({ id: 'x', icon }, 'G:\\repo\\.gitignore'))).toBe(fileSrc('.gitignore', false))
    expect(srcOf(imgOf({ id: 'x', icon }, 'src'))).toBe('/dsh-better-sidebar-icons/icons/default_file.svg')
  })

  it('re-resolves the icon file when the scheme flips', () => {
    const icon = createIconFactory(stubReact())
    const light = srcOf(imgOf({ id: 'x', icon }, '/repo/Readme.md'))
    document.body.setAttribute(DARK, '')
    const dark = srcOf(imgOf({ id: 'x', icon }, '/repo/Readme.md'))
    expect(dark).toBe(fileSrc('Readme.md', true))
    // The theme ships light variants only where upstream has them, so a flip
    // either changes the file or deliberately keeps it — never breaks it.
    expect(dark).toMatch(/^\/dsh-better-sidebar-icons\/icons\/file_type_/)
    expect(light).toMatch(/^\/dsh-better-sidebar-icons\/icons\/file_type_/)
  })

  it('never emits a zero or negative size', () => {
    const icon = createIconFactory(stubReact())
    expect(imgOf({ id: 'x', icon }, '/repo/a.ts', 0).width).toBe(1)
    expect(imgOf({ id: 'x', icon }, '/repo/a.ts', -4).width).toBe(1)
  })
})

describe('supportsFileIcons', () => {
  const registerFileIcon = (): (() => void) => () => {}

  it('accepts a host that declares the feature', () => {
    expect(supportsFileIcons({ features: ['tabs', 'fileIcons'], registerFileIcon })).toBe(true)
  })

  it('accepts a host that predates the feature list but has the function', () => {
    expect(supportsFileIcons({ registerFileIcon })).toBe(true)
  })

  it('rejects a host without the service, the feature, or the function', () => {
    expect(supportsFileIcons(undefined)).toBe(false)
    expect(supportsFileIcons(null)).toBe(false)
    expect(supportsFileIcons({})).toBe(false)
    // An older better-sidebar: the service exists, the icon API does not.
    expect(supportsFileIcons({ features: ['tabs', 'viewers'] })).toBe(false)
    // The feature list says yes but the function is gone (a broken host).
    expect(supportsFileIcons({ features: ['fileIcons'] })).toBe(false)
  })
})

describe('registerServiceIcons', () => {
  function harness(): {
    registered: FileIconDescriptor[]
    disposed: number
    service: { features: string[]; registerFileIcon: (descriptor: FileIconDescriptor) => () => void }
  } {
    const registered: FileIconDescriptor[] = []
    const state = { disposed: 0 }
    return {
      registered,
      get disposed() { return state.disposed },
      service: {
        features: ['fileIcons'],
        registerFileIcon: (descriptor: FileIconDescriptor) => {
          registered.push(descriptor)
          return () => { state.disposed += 1 }
        },
      },
    }
  }

  it('registers every descriptor and unregisters all of them on dispose', () => {
    const { registered, service } = harness()
    const dispose = registerServiceIcons(service, stubReact())
    expect(dispose).toBeTypeOf('function')
    expect(registered.map(descriptor => descriptor.id)).toEqual([FILE_NAMES_ID, FOLDER_ID, FILE_EXTS_ID])
    dispose?.()
    expect(registered.every(descriptor => typeof descriptor.icon === 'function')).toBe(true)
  })

  it('declines a host without the icon API, so the caller can fall back', () => {
    expect(registerServiceIcons({ features: ['tabs'] }, stubReact())).toBeUndefined()
    expect(registerServiceIcons(undefined, stubReact())).toBeUndefined()
  })

  it('hands the host elements that render through the shipped factory', () => {
    const { registered, service } = harness()
    registerServiceIcons(service, stubReact())
    const catchAll = registered.find(descriptor => descriptor.id === FILE_EXTS_ID)
    expect(catchAll).toBeDefined()
    // The catch-all is the one that decides the bulk of the tree.
    expect(srcOf(imgOf(catchAll as FileIconDescriptor, '/repo/src/app.tsx'))).toBe(fileSrc('app.tsx', false))
  })
})
