/**
 * dsh-better-sidebar-icons — host half.
 *
 * Mounts the icon assets route (/dsh-better-sidebar-icons/icons/<name>.svg) that
 * serves the bundled vscode-icons SVG set to the browser overlay. The client
 * half (src/client) does the DOM work; this half only serves bytes, behind
 * the same browser-trust fence every DSH route applies.
 */
import { isTrustedApiRequest } from './trust-fence.ts'
import { registerIconsRoute } from './icons-route.ts'
import type { HostContext, SidebarHttpRequest, SidebarWebRuntime, SidebarWebStartup } from './types.ts'

/** The webserver is the only required service. DSH 0.2.1 moved trusted hosts
 *  from webRuntime to webStartup, so look up either service when handling a
 *  request to keep this plugin loadable across both versions. */
export const inject = ['webServer']

export function apply(ctx: HostContext): void {
  // DSH 0.2.1 exposes invocation trust authorities through webStartup;
  // earlier releases provided them through webRuntime after the server bound.
  const fence = (req: SidebarHttpRequest): boolean => {
    const runtime = ctx.get('webRuntime') as SidebarWebRuntime | undefined
    const startup = ctx.get('webStartup') as SidebarWebStartup | undefined
    return isTrustedApiRequest(req, runtime?.trustedHosts ?? startup?.trustedHosts ?? [])
  }
  ctx.effect(
    () => registerIconsRoute(ctx, fence),
    'dsh-better-sidebar-icons: /dsh-better-sidebar-icons/icons asset route',
  )
}
