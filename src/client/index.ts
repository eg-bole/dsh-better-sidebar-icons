/**
 * dsh-better-sidebar-icons — client half.
 *
 * Replaces the file/folder glyphs of the right Sidebar's explorer with the
 * vscode-icons theme images served by the host half's
 * /dsh-better-sidebar-icons/icons route. Two paths, best first:
 *
 * 1. SERVICE (`dsh-better-sidebar` v0.19.1+, feature `fileIcons`): the theme
 *    registers through `ctx.betterSidebar.registerFileIcon` and the host
 *    renders the theme's own React elements for tree rows and file-tab chips.
 *    Exact (the host passes the real path and expansion state), supported, and
 *    no DOM is touched — see {@link ./service-icons.ts}.
 * 2. OVERLAY (fallback): a host without that service renders DSH's own
 *    explorer (`@deepseek-ai/dsh-client-ui-sidebar-files`), whose icons are
 *    shadowed in the DOM instead — see {@link ./override.ts}.
 *
 * Exactly one path runs per load, and both are fully restored on fiber
 * dispose.
 */
import type { Context } from '@deepseek-ai/cordis'
import { createIconOverlay } from './override.ts'
import { registerServiceIcons, supportsFileIcons, type ServiceIconReact } from './service-icons.ts'

/** The module-loader seed word holding the host's React (see the boot's
 *  `staticModules`). Declared because the web target ships no Node types; the
 *  bundle's own banner supplies it as the factory's parameter. */
declare const require: ((specifier: string) => unknown) | undefined

/**
 * The specifier is ASSEMBLED, never written as a literal.
 *
 * A literal `import`/`require` of `react` is resolved by the bundler, which
 * inlines React's own source into this bundle — a SECOND React instance whose
 * hooks belong to a dispatcher the host never installs, so every themed icon
 * would throw "Invalid hook call". The client half must instead borrow the
 * host's React through the module-loader `require` (the boot's `staticModules`
 * seeds exactly `react`, `react/jsx-runtime`, `react-dom`, … for this).
 */
function seedRequire(specifier: string): unknown {
  if (typeof require === 'function') return require(specifier)
  // Defensive: a harness that exposes the loader require on the global.
  const fallback = (globalThis as { require?: (specifier: string) => unknown }).require
  return typeof fallback === 'function' ? fallback(specifier) : undefined
}

/** The host React face, or `undefined` when the seed word is unavailable or
 *  does not carry the two hooks the themed icon needs. */
function hostReact(): ServiceIconReact | undefined {
  try {
    const react = seedRequire(['re', 'act'].join('')) as Partial<ServiceIconReact> | undefined
    if (typeof react?.createElement !== 'function') return undefined
    if (typeof react.useSyncExternalStore !== 'function') return undefined
    return react as ServiceIconReact
  } catch {
    return undefined
  }
}

/**
 * The `betterSidebar` service, when this host has one.
 *
 * `ctx.get(name)` is the client runner's OPTIONAL lookup — a direct
 * `ctx.betterSidebar` read is gated by the fiber's `inject` declaration and
 * throws ("… is not declared by your plugin") whatever the provider state. A
 * host that exposes no `get` at all (an older runner) answers `undefined`,
 * which is the same fallback.
 */
function optionalService(ctx: Context): unknown {
  const lookup = (ctx as unknown as { get?: (name: string) => unknown }).get
  if (typeof lookup !== 'function') return undefined
  try {
    return lookup.call(ctx, 'betterSidebar')
  } catch {
    return undefined
  }
}

/**
 * The services this client half REQUIRES. Deliberately none.
 *
 * better-sidebar's integration guide suggests `export const inject =
 * ['betterSidebar']`, but cordis' `Inject` carries no optional form — a
 * declared service that a profile never provides parks this plugin forever,
 * which would silently kill the fallback path below. The service is therefore
 * waited for explicitly instead (see {@link apply}), and this declaration stays
 * empty so the plugin always activates.
 */
export const inject: readonly string[] = []

/**
 * How long the service path waits for `betterSidebar` before giving up on it
 * and falling back to the DOM overlay. Only reached on a host that never
 * provides the service (i.e. without the better-sidebar package), where the
 * injected callback never fires.
 */
const SERVICE_WAIT_MS = 3000

export function apply(ctx: Context): void {
  ctx.effect(
    () => {
      let overlayDispose: (() => void) | undefined
      let attachDispose: (() => void) | undefined
      let settled = false
      let timer: ReturnType<typeof setTimeout> | undefined

      /** The overlay path: a host whose explorer is DSH's own. */
      const fallback = (): void => {
        if (settled) return
        settled = true
        if (timer !== undefined) clearTimeout(timer)
        const overlay = createIconOverlay()
        overlay.start()
        overlayDispose = () => overlay.dispose()
      }

      /** The service path: a host whose explorer is better-sidebar's. */
      const attach = (service: unknown): void => {
        if (settled) return
        const react = supportsFileIcons(service) ? hostReact() : undefined
        const dispose = react === undefined ? undefined : registerServiceIcons(service, react)
        if (dispose === undefined) return
        settled = true
        if (timer !== undefined) clearTimeout(timer)
        attachDispose = dispose
      }

      // `ctx.get` answers immediately when the provider is already up.
      attach(optionalService(ctx))
      if (!settled) {
        const wait = (ctx as unknown as { inject?: (deps: string[], cb: (ctx: Context) => void) => unknown }).inject
        if (typeof wait === 'function') {
          // The documented consume pattern, as its own child fiber: the callback
          // runs once `betterSidebar` is provided (immediately when it already
          // is), and receives that child's context. Nested this way the wait is
          // OPTIONAL — the outer plugin still activates — which a declared
          // `inject` cannot express.
          wait.call(ctx, ['betterSidebar'], (injected: Context) => {
            attach(optionalService(injected))
          })
          // A host that never provides it leaves the child fiber above waiting,
          // so the overlay takes over on its own.
          timer = setTimeout(fallback, SERVICE_WAIT_MS)
        } else {
          // No injection verb at all (an older runner, or a bare harness): the
          // lookup above was already the whole answer.
          fallback()
        }
      }

      return () => {
        if (timer !== undefined) clearTimeout(timer)
        overlayDispose?.()
        attachDispose?.()
      }
    },
    'dsh-better-sidebar-icons: explorer icon theme',
  )
}
