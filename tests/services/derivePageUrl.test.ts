import { describe, it, expect, vi, beforeEach } from 'vitest'
import { derivePageUrl, getInboxCollection } from '../../src/services/derivePageUrl.js'
import { createPage } from '../../src/services/createPage.js'
import { updateInboxFirst } from '../../src/services/updateInbox.js'
import { getPageInfo, PAGE_SIZE_LIMIT } from '../../src/services/getPageInfo.js'

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

describe('derivePageUrl', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(createPage).mockResolvedValue(undefined)
    vi.mocked(updateInboxFirst).mockResolvedValue(undefined)
  })

  describe('when inbox has no first page', () => {
    it('should create a new page and update inbox first', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 'https://example.com/inbox/', type: 'OrderedCollection' }), {
          status: 200,
          headers: { 'content-type': 'application/ld+json' },
        })
      )

      const result = await derivePageUrl('https://example.com/inbox/', mockFetch)

      expect(result).toMatch(/https:\/\/example\.com\/inbox\/pages\/\d+/)
      expect(createPage).toHaveBeenCalled()
      expect(updateInboxFirst).toHaveBeenCalled()
    })
  })

  describe('when first page exists and is not full', () => {
    it('should return the existing first page URL', async () => {
      const existingPage = 'https://example.com/inbox/pages/1234567890'
      mockFetch
        .mockResolvedValueOnce(
          new Response(JSON.stringify({
            id: 'https://example.com/inbox/',
            type: 'OrderedCollection',
            first: existingPage,
          }), {
            status: 200,
            headers: { 'content-type': 'application/ld+json' },
          })
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ items: ['a', 'b'] }), {
            status: 200,
            headers: { 'content-type': 'application/ld+json' },
          })
        )

      vi.mocked(getPageInfo).mockResolvedValueOnce({ itemCount: 2, isFull: false })

      const result = await derivePageUrl('https://example.com/inbox/', mockFetch)

      expect(result).toBe(existingPage)
      expect(createPage).not.toHaveBeenCalled()
    })
  })

  describe('when first page exists and is full', () => {
    it('should create a new page', async () => {
      const existingPage = 'https://example.com/inbox/pages/1234567890'
      mockFetch
        .mockResolvedValueOnce(
          new Response(JSON.stringify({
            id: 'https://example.com/inbox/',
            type: 'OrderedCollection',
            first: existingPage,
          }), {
            status: 200,
            headers: { 'content-type': 'application/ld+json' },
          })
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ items: Array(200).fill('x') }), {
            status: 200,
            headers: { 'content-type': 'application/ld+json' },
          })
        )

      vi.mocked(getPageInfo).mockResolvedValueOnce({ itemCount: 200, isFull: true })

      const result = await derivePageUrl('https://example.com/inbox/', mockFetch)

      expect(result).toMatch(/https:\/\/example\.com\/inbox\/pages\/\d+/)
      expect(createPage).toHaveBeenCalled()
    })
  })

  describe('when inbox URL does not end with /', () => {
    it('should normalize the URL', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 'https://example.com/inbox/', type: 'OrderedCollection' }), {
          status: 200,
          headers: { 'content-type': 'application/ld+json' },
        })
      )

      const result = await derivePageUrl('https://example.com/inbox', mockFetch)

      expect(result).toMatch(/^https:\/\/example\.com\/inbox\//)
    })
  })
})