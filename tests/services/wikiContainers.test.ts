import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SolidFetch } from '../../src/types/index.js'

const ROOT = 'https://pod.example.com/wiki/'

function createMockFetch(routes: Record<string, () => Response>): SolidFetch {
  return async (url: string | URL | Request) => {
    const urlStr =
      typeof url === 'string' ? url : url instanceof URL ? url.toString() : url.url
    const factory = routes[urlStr]
    if (!factory) {
      throw new Error(`No mock response for ${urlStr}`)
    }
    return factory()
  }
}

function turtleResponse(body: string): Response {
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/turtle' },
  })
}

describe('wikiContainers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('parseContainer', () => {
    it('separates child containers and resources by trailing slash and LDP type', async () => {
      const { parseContainer } = await import('../../src/services/wikiContainers.js')

      const turtle = `
@prefix ldp: <http://www.w3.org/ns/ldp#> .

<${ROOT}> ldp:contains <notes/>, <page.md>, <data>, <media> .
<${ROOT}media> a ldp:Container .
`

      const result = parseContainer(ROOT, turtle)

      expect(result.containers.sort()).toEqual([`${ROOT}media`, `${ROOT}notes/`].sort())
      expect(result.resources.sort()).toEqual([`${ROOT}data`, `${ROOT}page.md`].sort())
    })
  })

  describe('discoverWikiContainers', () => {
    it('maxDepth 0 returns root plus root-level .md files only', async () => {
      const { discoverWikiContainers } = await import('../../src/services/wikiContainers.js')

      const fetch = createMockFetch({
        [ROOT]: () =>
          turtleResponse(
            `<${ROOT}> <http://www.w3.org/ns/ldp#contains> <${ROOT}readme.md>, <${ROOT}notes/> .`
          ),
      })

      const result = await discoverWikiContainers(ROOT, 0, fetch)

      expect(result.containers).toEqual([ROOT])
      expect(result.markdownFiles).toEqual([`${ROOT}readme.md`])
    })

    it('maxDepth 1 returns immediate child containers and their .md files', async () => {
      const { discoverWikiContainers } = await import('../../src/services/wikiContainers.js')

      const fetch = createMockFetch({
        [ROOT]: () =>
          turtleResponse(
            `<${ROOT}> <http://www.w3.org/ns/ldp#contains> <${ROOT}readme.md>, <${ROOT}notes/>, <${ROOT}drafts/> .`
          ),
        [`${ROOT}notes/`]: () =>
          turtleResponse(
            `<${ROOT}notes/> <http://www.w3.org/ns/ldp#contains> <${ROOT}notes/note.md>, <${ROOT}notes/deep/> .`
          ),
        [`${ROOT}drafts/`]: () =>
          turtleResponse(
            `<${ROOT}drafts/> <http://www.w3.org/ns/ldp#contains> <${ROOT}drafts/idea.md> .`
          ),
      })

      const result = await discoverWikiContainers(ROOT, 1, fetch)

      expect(result.containers.sort()).toEqual(
        [ROOT, `${ROOT}notes/`, `${ROOT}drafts/`].sort()
      )
      expect(result.markdownFiles.sort()).toEqual(
        [`${ROOT}readme.md`, `${ROOT}notes/note.md`, `${ROOT}drafts/idea.md`].sort()
      )
    })

    it('maxDepth 2 returns grandchildren', async () => {
      const { discoverWikiContainers } = await import('../../src/services/wikiContainers.js')

      const fetch = createMockFetch({
        [ROOT]: () =>
          turtleResponse(
            `<${ROOT}> <http://www.w3.org/ns/ldp#contains> <${ROOT}notes/> .`
          ),
        [`${ROOT}notes/`]: () =>
          turtleResponse(
            `<${ROOT}notes/> <http://www.w3.org/ns/ldp#contains> <${ROOT}notes/deep/> .`
          ),
        [`${ROOT}notes/deep/`]: () =>
          turtleResponse(
            `<${ROOT}notes/deep/> <http://www.w3.org/ns/ldp#contains> <${ROOT}notes/deep/page.md>, <${ROOT}notes/deep/too-far/> .`
          ),
        [`${ROOT}notes/deep/too-far/`]: () =>
          turtleResponse(
            `<${ROOT}notes/deep/too-far/> <http://www.w3.org/ns/ldp#contains> <${ROOT}notes/deep/too-far/x.md> .`
          ),
      })

      const result = await discoverWikiContainers(ROOT, 2, fetch)

      expect(result.containers.sort()).toEqual(
        [ROOT, `${ROOT}notes/`, `${ROOT}notes/deep/`].sort()
      )
      expect(result.markdownFiles.sort()).toEqual(
        [`${ROOT}notes/deep/page.md`].sort()
      )
    })

    it('skips hidden and node_modules containers and does not follow URLs outside root', async () => {
      const { discoverWikiContainers } = await import('../../src/services/wikiContainers.js')

      const fetch = createMockFetch({
        [ROOT]: () =>
          turtleResponse(
            `<${ROOT}> <http://www.w3.org/ns/ldp#contains> <${ROOT}.git/>, <${ROOT}node_modules/>, <${ROOT}.secret.md>, <${ROOT}notes/>, <https://other.example.com/outside/> .`
          ),
      })

      const result = await discoverWikiContainers(ROOT, 3, fetch)

      expect(result.containers.sort()).toEqual([ROOT, `${ROOT}notes/`].sort())
      expect(result.markdownFiles).toEqual([])
    })

    it('does not throw when a container GET fails and continues other branches', async () => {
      const { discoverWikiContainers } = await import('../../src/services/wikiContainers.js')

      const fetch = createMockFetch({
        [ROOT]: () =>
          turtleResponse(
            `<${ROOT}> <http://www.w3.org/ns/ldp#contains> <${ROOT}broken/>, <${ROOT}ok/> .`
          ),
        [`${ROOT}broken/`]: () => new Response('boom', { status: 500 }),
        [`${ROOT}ok/`]: () =>
          turtleResponse(
            `<${ROOT}ok/> <http://www.w3.org/ns/ldp#contains> <${ROOT}ok/good.md> .`
          ),
      })

      const result = await discoverWikiContainers(ROOT, 1, fetch)

      expect(result.markdownFiles).toEqual([`${ROOT}ok/good.md`])
      expect(result.containers).toContain(ROOT)
      expect(result.containers).toContain(`${ROOT}ok/`)
    })
  })
})
