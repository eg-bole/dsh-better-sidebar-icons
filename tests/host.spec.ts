import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { apply, inject } from '../src/index.ts'
import type { HostContext, SidebarHttpResponse, SidebarWebRoute } from '../src/types.ts'

async function mount(services: Record<string, object>) {
  const ctx = new Context()
  const routes: SidebarWebRoute[] = []
  ctx.provide('webServer', {
    register(route: SidebarWebRoute) {
      routes.push(route)
      return () => { routes.splice(routes.indexOf(route), 1) }
    },
  })
  for (const [name, service] of Object.entries(services)) ctx.provide(name, service)
  const fiber = ctx.plugin({ inject, apply: scope => apply(scope as unknown as HostContext) })
  await new Promise<void>(resolve => setImmediate(resolve))
  return { ctx, fiber, routes }
}

async function request(route: SidebarWebRoute, host: string, extraHeaders: Record<string, string> = {}) {
  const response: SidebarHttpResponse = {
    statusCode: 0,
    writeHead(status) { this.statusCode = status },
    end() {},
  }
  await route.handler({
    url: '/dsh-better-sidebar-icons/icons/file_type_typescript.svg',
    method: 'GET',
    headers: { host, ...extraHeaders },
    async *[Symbol.asyncIterator]() {},
  }, response)
  return response.statusCode
}

describe('host activation across DSH trust service versions', () => {
  it('activates and serves startup-trusted hosts without webRuntime', async () => {
    const { fiber, routes } = await mount({ webStartup: { trustedHosts: ['lab.internal'] } })
    try {
      expect(routes).toHaveLength(1)
      expect(await request(routes[0]!, 'lab.internal:3083')).toBe(200)
      expect(await request(routes[0]!, 'untrusted.internal')).toBe(403)
      expect(await request(routes[0]!, 'lab.internal', { 'sec-fetch-site': 'cross-site' })).toBe(403)
    } finally {
      await fiber.dispose()
    }
    expect(routes).toHaveLength(0)
  })

  it('reads the older runtime service even when it arrives after activation', async () => {
    const { ctx, fiber, routes } = await mount({})
    try {
      expect(routes).toHaveLength(1)
      expect(await request(routes[0]!, 'old-runtime.internal')).toBe(403)
      ctx.provide('webRuntime', { trustedHosts: ['old-runtime.internal'] })
      expect(await request(routes[0]!, 'old-runtime.internal')).toBe(200)
    } finally {
      await fiber.dispose()
    }
  })
})
