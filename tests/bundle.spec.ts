// @vitest-environment jsdom
/**
 * Built-bundle contract test: loads the PUBLISHED artifact (lib/client.js), not
 * the sources, exactly the way the DSH web shell loads a client plugin — the
 * IIFE registers itself on `window.__ModuleLoader__`, and the shell hands its
 * factory a `require` over the shared module table.
 *
 * This is the only test that exercises the bundle's own registration form (id,
 * banner/footer, CJS wrapper) and the cordis `apply` entry together, so a
 * build-config regression cannot pass on source tests alone.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const BUNDLE = readFileSync(join(import.meta.dirname, '..', 'lib', 'client.js'), 'utf8')

const IMG_MARK = 'data-dsh-file-icon-overlay-img'
const MARK = 'data-dsh-file-icon-overlay'
const SERVICE_IMG_MARK = 'data-dsh-file-icon-service-img'

interface Loaded {
  id: string
  exports: { apply?: (ctx: unknown) => void; inject?: readonly string[] }
}
/** The one module the client half is allowed to ask the loader for: the
 *  host's React (a boot seed word). Anything else is a bundling bug. */
const REACT_SPECIFIER = 'react'

/** A React face enough for the bundle's own probes, and enough to RENDER a
 *  function component the way React would (call it) so the themed `<img>` is
 *  observable as a real object. */
function stubReact(): Record<string, unknown> {
  return {
    createElement: (type: unknown, props: Record<string, unknown> | null) =>
      typeof type === 'function' ? (type as (props: unknown) => unknown)(props ?? {}) : { type, props },
    useSyncExternalStore: (_subscribe: (onChange: () => void) => () => void, getSnapshot: () => unknown) => getSnapshot(),
  }
}

/** Load the bundle the way the shell does and return its registered row. */
function loadBundle(options: { withReact?: boolean } = {}): Loaded {
  const rows: { id: string; factory: (require: (spec: string) => unknown) => unknown }[] = []
  const win = window as unknown as { __ModuleLoader__?: { load(row: { id: string; factory: (require: (spec: string) => unknown) => unknown }): void } }
  win.__ModuleLoader__ = { load: row => { rows.push(row) } }
  // The bundle is a classic script; evaluating it in this realm mirrors the
  // browser's own evaluation of the served client module.
  // eslint-disable-next-line no-new-func
  new Function(BUNDLE)()
  expect(rows.length).toBe(1)
  const row = rows[0]!
  // The client half declares no shared-module request beyond React; any other
  // `require` is a bug (it also proves React was NOT inlined: an inlined copy
  // never reaches the loader at all).
  const exports = row.factory(spec => {
    if (options.withReact === true && spec === REACT_SPECIFIER) return stubReact()
    throw new Error(`unexpected module request: ${spec}`)
  }) as Loaded['exports']
  return { id: row.id, exports }
}

const ROOT = 'G:\\Program\\personal\\dsh-follow'

function mountRealDom(): void {
  document.body.innerHTML = `
    <div data-sidebar-right-session="s1" data-sidebar-right-panel="push">
      <div data-dockkit-pane>
        <span data-sidebar-right-tab="@deepseek-ai/dsh-client-ui-sidebar-files">
          <svg width="16" height="16" viewBox="0 0 28 28"></svg>files
        </span>
        <div data-files-body>
          <div data-files-state="tree" data-files-root="${ROOT}">
            <ul>
              <li data-files-entry="directory" data-files-path="${ROOT}\\packages">
                <button type="button" aria-expanded="true">
                  <svg width="16" height="16" viewBox="0 0 28 28"></svg><span>packages</span>
                </button>
              </li>
              <li data-files-entry="file" data-files-path="${ROOT}\\package.json">
                <button type="button">
                  <svg width="16" height="16" viewBox="0 0 20 20"></svg><span>package.json</span>
                </button>
              </li>
            </ul>
          </div>
        </div>
      </div>
    </div>`
}

/**
 * A cordis ctx in miniature: `effect` runs the body and collects the cleanup,
 * `get(name)` is the optional service lookup, and `inject` is the documented
 * child-fiber wait (`ctx.inject = (deps, cb) => ctx.plugin({ inject, apply: cb })`
 * in cordis core) — here it fires only when the named service is present, which
 * is what makes the absent-service fallback observable.
 */
function makeCtx(services: Record<string, unknown> = {}): {
  ctx: Record<string, unknown>
  disposers: (() => void)[]
  injected: string[][]
} {
  const disposers: (() => void)[] = []
  const injected: string[][] = []
  const ctx: Record<string, unknown> = {
    get: (name: string) => services[name],
    inject: (deps: string[], callback: (ctx: unknown) => void) => {
      injected.push(deps)
      if (deps.every(dep => services[dep] !== undefined)) callback({ get: (name: string) => services[name] })
      return undefined
    },
    effect: (fn: () => void | (() => void)) => {
      const dispose = fn()
      if (typeof dispose === 'function') disposers.push(dispose)
    },
  }
  return { ctx, disposers, injected }
}

beforeEach(() => {
  document.body.innerHTML = ''
  document.head.innerHTML = ''
  document.body.setAttribute('data-ds-dark-theme', '')
})

afterEach(() => {
  document.head.querySelectorAll('style').forEach(node => node.remove())
})

describe('lib/client.js', () => {
  it('registers itself under the package name and exports apply/inject', () => {
    const loaded = loadBundle()
    expect(loaded.id).toBe('dsh-better-sidebar-icons')
    expect(typeof loaded.exports.apply).toBe('function')
    // The declaration must stay EMPTY: a required `betterSidebar` would park
    // the plugin on a host that has no better-sidebar, killing the fallback.
    expect(loaded.exports.inject).toEqual([])
  })

  it('overlays the real host DOM through cordis apply, and disposes cleanly', async () => {
    mountRealDom()
    const { ctx, disposers } = makeCtx()
    vi.useFakeTimers()
    try {
      loadBundle().exports.apply!(ctx)
      // No service in this ctx, so the overlay arrives on the fallback timer —
      // the same wait a real host spends on the injected child fiber.
      await vi.advanceTimersByTimeAsync(5000)
      // Dark theme is on in this fixture: the dark variant is in force.
      const row = document.querySelector('li[data-files-path$="packages"]')!
      const img = row.querySelector<HTMLImageElement>(`img[${IMG_MARK}]`)
      expect(img).not.toBeNull()
      expect(new URL(img!.src).pathname).toBe('/dsh-better-sidebar-icons/icons/folder_type_package_opened.svg')
      // Two tree rows plus the files chip.
      expect(document.querySelectorAll(`img[${IMG_MARK}]`).length).toBe(3)
      expect(document.head.querySelector('style')).not.toBeNull()
    } finally {
      vi.useRealTimers()
      for (const dispose of disposers) dispose()
    }
    expect(document.querySelector(`img[${IMG_MARK}]`)).toBeNull()
    expect(document.querySelector(`[${MARK}]`)).toBeNull()
    expect(document.head.querySelector('style')).toBeNull()
  })

  it('takes the service path when the host exposes betterSidebar, and leaves the DOM alone', () => {
    const registered: { id: string; icon: (path: string, size: number, open?: boolean) => unknown }[] = []
    const service = {
      features: ['tabs', 'fileIcons'],
      registerFileIcon: (descriptor: { id: string; icon: (path: string, size: number, open?: boolean) => unknown }) => {
        registered.push(descriptor)
        return () => {}
      },
    }
    mountRealDom()
    const { ctx, disposers, injected } = makeCtx({ betterSidebar: service })
    try {
      loadBundle({ withReact: true }).exports.apply!(ctx)
      // The three descriptors, in registration order.
      expect(registered.map(descriptor => descriptor.id)).toEqual([
        'dsh-better-sidebar-icons:file-names',
        'dsh-better-sidebar-icons:folder',
        'dsh-better-sidebar-icons:file-exts',
      ])
      // The service answered the immediate lookup, so nothing waits on inject.
      expect(injected).toEqual([])
      // The service path renders through the host, so this bundle touches no DOM:
      // no overlay image and no injected stylesheet.
      expect(document.querySelectorAll(`img[${IMG_MARK}]`).length).toBe(0)
      expect(document.head.querySelector('style')).toBeNull()
      // The factory the host would call produces the theme's own <img>.
      const catchAll = registered.find(descriptor => descriptor.id === 'dsh-better-sidebar-icons:file-exts')!
      const element = catchAll.icon(`${ROOT}\\package.json`, 14) as { props: Record<string, unknown> }
      expect(String(element.props.src)).toContain('/dsh-better-sidebar-icons/icons/')
      expect(element.props[SERVICE_IMG_MARK]).toBe('')
    } finally {
      for (const dispose of disposers) dispose()
    }
  })

  it('waits for the service on inject when the provider is not up yet', () => {
    const registered: { id: string }[] = []
    const service = {
      features: ['fileIcons'],
      registerFileIcon: (descriptor: { id: string }) => {
        registered.push(descriptor)
        return () => {}
      },
    }
    mountRealDom()
    // The lookup misses, but the child-fiber wait finds it — the exact race the
    // host exposes when the better-sidebar bundle materializes after this one.
    const services: Record<string, unknown> = {}
    const { ctx, disposers, injected } = makeCtx(services)
    ctx.inject = (deps: string[], callback: (ctx: unknown) => void) => {
      injected.push(deps)
      // The provider arrives before the callback runs, as cordis guarantees.
      services.betterSidebar = service
      callback({ get: (name: string) => services[name] })
      return undefined
    }
    try {
      loadBundle({ withReact: true }).exports.apply!(ctx)
      expect(injected).toEqual([['betterSidebar']])
      expect(registered.length).toBe(3)
      // The service path took over, so no overlay DOM appeared.
      expect(document.querySelectorAll(`img[${IMG_MARK}]`).length).toBe(0)
    } finally {
      for (const dispose of disposers) dispose()
    }
  })

  it('falls back to the overlay when the host has no service or no React seed', async () => {
    mountRealDom()
    // A service without the icon API: the overlay must take over, on the timer
    // that stands in for the child-fiber wait a real host would leave pending.
    const { ctx, disposers } = makeCtx({ betterSidebar: { features: ['tabs'] } })
    vi.useFakeTimers()
    try {
      loadBundle().exports.apply!(ctx)
      await vi.advanceTimersByTimeAsync(5000)
      expect(document.querySelectorAll(`img[${IMG_MARK}]`).length).toBe(3)
    } finally {
      vi.useRealTimers()
      for (const dispose of disposers) dispose()
    }
  })
})
