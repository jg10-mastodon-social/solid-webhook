import { describe, it, expect, vi, beforeEach } from 'vitest'
import { derivePageUrl, getInboxCollection } from '../../src/services/derivePageUrl.js'
import { createPage } from '../../src/services/createPage.js'
import { updateInboxFirst } from '../../src/services/updateInbox.js'
import { getPageInfo, PAGE_SIZE_LIMIT } from '../../src/services/getPageInfo.js'
import { updatePageNext } from '../../src/services/updatePageNext.js'

const mockFetch = vi.fn()

vi.mock('../../src/services/createPage.js', () => ({
  createPage: vi.fn(),
}))

vi.mock('../../src/services/updateInbox.js', () => ({
  updateInboxFirst: vi.fn(),
}))

vi.mock('../../src/services/getPageInfo.js', () => ({
  getPageInfo: vi.fn(),
  PAGE_SIZE_LIMIT: 200,
}))

vi.mock('../../src/services/updatePageNext.ts', () => ({
  updatePageNext: vi.fn(),
}))

describe('derivePageUrl', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(createPage).mockResolvedValue(undefined)
    vi.mocked(updateInboxFirst).mockResolvedValue(undefined)
    vi.mocked(updatePageNext).mockResolvedValue(undefined)
  })

  describe('getInboxCollection', () => {
    it('should return collection with first URL when as:first exists', async () => {
      const turtleBody = `@prefix as: <https://www.w3.org/ns/activitystreams#>.
<https://example.com/inbox/> a as:OrderedCollection;
  as:first <https://example.com/inbox/pages/1234567890>.`

      mockFetch.mockResolvedValue(
        new Response(turtleBody, {
          status: 200,
          headers: { 'content-type': 'text/turtle' },
        })
      )

      const result = await getInboxCollection('https://example.com/inbox/', mockFetch)

      expect(result).not.toBeNull()
      expect(result?.first).toBe('https://example.com/inbox/pages/1234567890')
    })

    it('should return null when inbox has no as:first', async () => {
      const turtleBody = `@prefix as: <https://www.w3.org/ns/activitystreams#>.
<https://example.com/inbox/> a as:OrderedCollection.`

      mockFetch.mockResolvedValue(
        new Response(turtleBody, {
          status: 200,
          headers: { 'content-type': 'text/turtle' },
        })
      )

      const result = await getInboxCollection('https://example.com/inbox/', mockFetch)

      expect(result).toBeNull()
    })

    it('should throw on non-404 fetch error', async () => {
      mockFetch.mockResolvedValue(
        new Response('Server error', { status: 500 })
      )

      await expect(
        getInboxCollection('https://example.com/inbox/', mockFetch)
      ).rejects.toThrow('Failed to fetch inbox')
    })

    it('should return null on 404', async () => {
      mockFetch.mockResolvedValue(
        new Response(null, { status: 404 })
      )

      const result = await getInboxCollection('https://example.com/inbox/', mockFetch)

      expect(result).toBeNull()
    })
  })

  describe('derivePageUrl', () => {
    describe('when inbox has no first page', () => {
      it('should create a new page and update inbox first', async () => {
        const turtleBody = `@prefix as: <https://www.w3.org/ns/activitystreams#>.
<https://example.com/inbox/> a as:OrderedCollection.`

        mockFetch.mockResolvedValue(
          new Response(turtleBody, {
            status: 200,
            headers: { 'content-type': 'text/turtle' },
          })
        )

        const result = await derivePageUrl('https://example.com/inbox/', mockFetch)

        expect(result).toMatch(/https:\/\/example\.com\/inbox\/pages\/\d+/)
        expect(createPage).toHaveBeenCalled()
        expect(updateInboxFirst).toHaveBeenCalled()
      })

      it('should create page without prev link when no first page exists', async () => {
        const turtleBody = `@prefix as: <https://www.w3.org/ns/activitystreams#>.
<https://example.com/inbox/> a as:OrderedCollection.`

        mockFetch.mockResolvedValue(
          new Response(turtleBody, {
            status: 200,
            headers: { 'content-type': 'text/turtle' },
          })
        )

        await derivePageUrl('https://example.com/inbox/', mockFetch)

        expect(createPage).toHaveBeenCalledWith(
          expect.any(String),
          'https://example.com/inbox/',
          mockFetch,
          undefined
        )
      })

      it('should not call updatePageNext when no first page exists', async () => {
        const turtleBody = `@prefix as: <https://www.w3.org/ns/activitystreams#>.
<https://example.com/inbox/> a as:OrderedCollection.`

        mockFetch.mockResolvedValue(
          new Response(turtleBody, {
            status: 200,
            headers: { 'content-type': 'text/turtle' },
          })
        )

        await derivePageUrl('https://example.com/inbox/', mockFetch)

        expect(updatePageNext).not.toHaveBeenCalled()
      })
    })

    describe('when first page exists and is not full', () => {
      it('should return the existing first page URL', async () => {
        const existingPage = 'https://example.com/inbox/pages/1234567890'
        const turtleBody = `@prefix as: <https://www.w3.org/ns/activitystreams#>.
<https://example.com/inbox/> a as:OrderedCollection;
  as:first <${existingPage}>.`

        mockFetch.mockResolvedValue(
          new Response(turtleBody, {
            status: 200,
            headers: { 'content-type': 'text/turtle' },
          })
        )

        vi.mocked(getPageInfo).mockResolvedValueOnce({ itemCount: 2, isFull: false })

        const result = await derivePageUrl('https://example.com/inbox/', mockFetch)

        expect(result).toBe(existingPage)
        expect(createPage).not.toHaveBeenCalled()
      })
    })

    describe('when first page exists and is full', () => {
      it('should create a new page with prev link to existing page', async () => {
        const existingPage = 'https://example.com/inbox/pages/1234567890'
        const turtleBody = `@prefix as: <https://www.w3.org/ns/activitystreams#>.
<https://example.com/inbox/> a as:OrderedCollection;
  as:first <${existingPage}>.`

        mockFetch.mockResolvedValue(
          new Response(turtleBody, {
            status: 200,
            headers: { 'content-type': 'text/turtle' },
          })
        )

        vi.mocked(getPageInfo).mockResolvedValueOnce({ itemCount: 200, isFull: true })

        const result = await derivePageUrl('https://example.com/inbox/', mockFetch)

        expect(result).toMatch(/https:\/\/example\.com\/inbox\/pages\/\d+/)
        expect(createPage).toHaveBeenCalledWith(
          expect.any(String),
          'https://example.com/inbox/',
          mockFetch,
          existingPage
        )
      })

      it('should add as:next link on the existing page', async () => {
        const existingPage = 'https://example.com/inbox/pages/1234567890'
        const turtleBody = `@prefix as: <https://www.w3.org/ns/activitystreams#>.
<https://example.com/inbox/> a as:OrderedCollection;
  as:first <${existingPage}>.`

        mockFetch.mockResolvedValue(
          new Response(turtleBody, {
            status: 200,
            headers: { 'content-type': 'text/turtle' },
          })
        )

        vi.mocked(getPageInfo).mockResolvedValueOnce({ itemCount: 200, isFull: true })

        const result = await derivePageUrl('https://example.com/inbox/', mockFetch)

        expect(updatePageNext).toHaveBeenCalledWith(
          existingPage,
          result,
          mockFetch
        )
      })
    })
  })
})