// @vitest-environment jsdom
/**
 * DOM overlay tests (src/client/override.ts): the overlay swaps the
 * better-sidebar explorer row svg icons (VscFile / VscFolder /
 * VscFolderOpened shapes) and editor-tab icons for the plugin-route theme
 * images. Pins row detection (title ⇒ file, folder path shape ⇒ open/closed,
 * no role ⇒ root), tab detection (title resolves to a real file), the
 * React-re-render re-apply loop (exactly one icon per element), scheme
 * flips, and unload restoration.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { createIconOverlay } from '../src/client/override.ts'

const FOLDER_CLOSED_D = 'M2 4.5V6H5.58579'
const FOLDER_OPEN_D = 'M2 4.5V9.10022L2.92389'
const FILE_D = 'M1 1H15V15H1Z'

const srcPath = (img: HTMLImageElement | null | undefined): string =>
  img === null || img === undefined ? '' : new URL(img.src).pathname

function makeSvg(d: string): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  path.setAttribute('d', d)
  svg.appendChild(path)
  return svg
}

function fileRow(name: string, path: string): HTMLDivElement {
  const row = document.createElement('div')
  row.setAttribute('role', 'button')
  row.setAttribute('tabindex', '0')
  row.setAttribute('title', path)
  row.appendChild(makeSvg(FILE_D))
  const span = document.createElement('span')
  span.className = 'abc_explorerName'
  span.textContent = name
  row.appendChild(span)
  return row
}

function folderRow(name: string, open: boolean): HTMLDivElement {
  const row = document.createElement('div')
  row.setAttribute('role', 'button')
  row.appendChild(makeSvg(open ? FOLDER_OPEN_D : FOLDER_CLOSED_D))
  const span = document.createElement('span')
  span.className = 'abc_explorerName'
  span.textContent = name
  row.appendChild(span)
  return row
}

function rootRow(name: string): HTMLDivElement {
  const row = document.createElement('div')
  row.className = 'abc_explorerRow'
  row.appendChild(makeSvg(FOLDER_OPEN_D))
  const span = document.createElement('span')
  span.className = 'abc_explorerName'
  span.textContent = name
  row.appendChild(span)
  return row
}

function tabRow(title: string, iconD: string): HTMLDivElement {
  const tab = document.createElement('div')
  tab.setAttribute('title', title)
  tab.appendChild(makeSvg(iconD))
  const span = document.createElement('span')
  span.className = 'abc_tabTitle'
  span.textContent = title
  tab.appendChild(span)
  const close = document.createElement('button')
  close.appendChild(makeSvg('M1 1L15 15'))
  tab.appendChild(close)
  return tab
}

function mountHost(rows: HTMLElement[]): HTMLElement {
  const host = document.createElement('div')
  host.setAttribute('data-dsh-better-sidebar', '')
  for (const row of rows) host.appendChild(row)
  document.body.appendChild(host)
  return host
}

const tick = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 10))

beforeEach(() => {
  document.body.innerHTML = ''
})

describe('row overlay', () => {
  it('overlays file rows with the resolved icon (title ⇒ file)', async () => {
    const host = mountHost([fileRow('package.json', '/workspace/package.json')])
    const overlay = createIconOverlay()
    overlay.start()
    await tick()
    const img = host.querySelector<HTMLImageElement>('img[data-dsh-better-sidebar-icons]')
    expect(img).not.toBeNull()
    expect(srcPath(img)).toBe('/dsh-better-sidebar-icons/icons/file_type_npm.svg')
    expect(img!.width).toBe(14)
  })

  it('overlays folder rows with closed/open variants (path shape ⇒ state)', async () => {
    const host = mountHost([folderRow('src', false), folderRow('src', true)])
    const overlay = createIconOverlay()
    overlay.start()
    await tick()
    const imgs = host.querySelectorAll<HTMLImageElement>('img[data-dsh-better-sidebar-icons]')
    expect(imgs.length).toBe(2)
    expect(srcPath(imgs[0])).toBe('/dsh-better-sidebar-icons/icons/folder_type_src.svg')
    expect(srcPath(imgs[1])).toBe('/dsh-better-sidebar-icons/icons/folder_type_src_opened.svg')
  })

  it('overlays the root row with the root folder icon (no role ⇒ root, opened)', async () => {
    const host = mountHost([rootRow('workspace')])
    const overlay = createIconOverlay()
    overlay.start()
    await tick()
    const img = host.querySelector<HTMLImageElement>('img[data-dsh-better-sidebar-icons]')
    expect(img).not.toBeNull()
    expect(srcPath(img)).toBe('/dsh-better-sidebar-icons/icons/default_root_folder_opened.svg')
  })

  it('ignores role=button chrome without an explorerName label', async () => {
    const host = mountHost([])
    const button = document.createElement('button')
    button.setAttribute('role', 'button')
    button.setAttribute('title', 'referenceFile')
    button.appendChild(makeSvg(FILE_D))
    host.appendChild(button)
    const overlay = createIconOverlay()
    overlay.start()
    await tick()
    expect(host.querySelector('img[data-dsh-better-sidebar-icons]')).toBeNull()
  })

  it('re-applies after React restores the svg, leaving exactly one icon', async () => {
    const host = mountHost([fileRow('main.py', '/workspace/main.py')])
    const overlay = createIconOverlay()
    overlay.start()
    await tick()
    expect(host.querySelectorAll('img[data-dsh-better-sidebar-icons]').length).toBe(1)
    // Simulate a React re-render: the svg is back, the img is gone.
    const row = host.firstElementChild as HTMLElement
    row.replaceChild(makeSvg(FILE_D), row.querySelector('img[data-dsh-better-sidebar-icons]')!)
    await tick()
    const imgs = host.querySelectorAll<HTMLImageElement>('img[data-dsh-better-sidebar-icons]')
    expect(imgs.length).toBe(1)
    expect(srcPath(imgs[0])).toBe('/dsh-better-sidebar-icons/icons/file_type_python.svg')
  })

  it('restores the original svg on dispose', async () => {
    const host = mountHost([fileRow('package.json', '/workspace/package.json'), folderRow('src', false)])
    const overlay = createIconOverlay()
    overlay.start()
    await tick()
    expect(host.querySelectorAll('img[data-dsh-better-sidebar-icons]').length).toBe(2)
    overlay.dispose()
    const rows = host.children
    expect(rows[0]!.firstElementChild!.tagName.toLowerCase()).toBe('svg')
    expect(rows[1]!.firstElementChild!.tagName.toLowerCase()).toBe('svg')
    expect(host.querySelector('img[data-dsh-better-sidebar-icons]')).toBeNull()
  })

  it('starts once the host mounts (async sidebar)', async () => {
    const overlay = createIconOverlay()
    overlay.start()
    await tick()
    expect(document.querySelector('img[data-dsh-better-sidebar-icons]')).toBeNull()
    const host = mountHost([fileRow('index.ts', '/workspace/index.ts')])
    await tick()
    const img = host.querySelector<HTMLImageElement>('img[data-dsh-better-sidebar-icons]')
    expect(img).not.toBeNull()
    expect(srcPath(img)).toBe('/dsh-better-sidebar-icons/icons/file_type_typescript.svg')
    overlay.dispose()
  })

  it('flips icon variants on scheme change (body[data-ds-dark-theme])', async () => {
    document.body.removeAttribute('data-ds-dark-theme')
    const host = mountHost([fileRow('hello.ada', '/workspace/hello.ada')])
    const overlay = createIconOverlay()
    overlay.start()
    await tick()
    const img = host.querySelector<HTMLImageElement>('img[data-dsh-better-sidebar-icons]')
    expect(srcPath(img)).toBe('/dsh-better-sidebar-icons/icons/file_type_light_ada.svg')
    document.body.setAttribute('data-ds-dark-theme', '')
    await tick()
    expect(srcPath(img)).toBe('/dsh-better-sidebar-icons/icons/file_type_ada.svg')
    overlay.dispose()
  })
})

describe('tab overlay', () => {
  it('overlays a file tab whose title resolves to a real file icon', async () => {
    const host = mountHost([tabRow('main.ts', FILE_D)])
    const overlay = createIconOverlay()
    overlay.start()
    await tick()
    const img = host.querySelector<HTMLImageElement>('img[data-dsh-better-sidebar-icons]')
    expect(img).not.toBeNull()
    expect(srcPath(img)).toBe('/dsh-better-sidebar-icons/icons/file_type_typescript.svg')
  })

  it('leaves built-in tabs (non-file titles) untouched', async () => {
    const host = mountHost([tabRow('Git', FILE_D), tabRow('Terminal', FILE_D), tabRow('Files', FILE_D)])
    const overlay = createIconOverlay()
    overlay.start()
    await tick()
    expect(host.querySelector('img[data-dsh-better-sidebar-icons]')).toBeNull()
  })

  it('restores tab icons on dispose', async () => {
    const host = mountHost([tabRow('notes.md', FILE_D)])
    const overlay = createIconOverlay()
    overlay.start()
    await tick()
    expect(host.querySelector('img[data-dsh-better-sidebar-icons]')).not.toBeNull()
    overlay.dispose()
    expect(host.querySelector('img[data-dsh-better-sidebar-icons]')).toBeNull()
    const tab = host.firstElementChild as HTMLElement
    expect(tab.firstElementChild!.tagName.toLowerCase()).toBe('svg')
  })
})
