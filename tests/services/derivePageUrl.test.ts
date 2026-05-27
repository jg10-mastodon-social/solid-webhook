import { describe, it, expect, vi, beforeEach } from 'vitest'
import { derivePageUrl, getInboxCollection } from '../../src/services/derivePageUrl.js'
import { createPage } from '../../src/services/createPage.js'
import { updateInboxFirst } from '../../src/services/updateInbox.js'
import { getPageInfo, PAGE_SIZE_LIMIT } from '../../src/services/getPageInfo.js'
import { discoverMetaResourceUrl } from '../../src/services/solidHelpers.js'

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

vi.mock('../../src/services/solidHelpers.js', () => ({
  discoverMetaResourceUrl: vi.fn(),
}))

describe('derivePageUrl', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(createPage).mockResolvedValue(undefined)
    vi.mocked(updateInboxFirst).mockResolvedValue(undefined)
    vi.mocked(discoverMetaResourceUrl).mockResolvedValue('https://example.com/inbox/.meta')
  })

  describe('for container URLs', () => {
    it('should discover meta resource URL first', async () => {
      mockFetch.mockResolvedValue(
        new Response(JSON.stringify({ id: 'https://example.com/inbox/', type: 'OrderedCollection' }), {
          status: 200,
          headers: { 'content-type': 'application/ld+json' },
        })
      )

      await derivePageUrl('https://example.com/inbox/', mockFetch)

      expect(discoverMetaResourceUrl).toHaveBeenCalledWith(
        'https://example.com/inbox/',
        mockFetch
      )
    })

    it('should get inbox collection from meta resource', async () => {
      mockFetch.mockResolvedValue(
        new Response(JSON.stringify({ id: 'https://example.com/inbox/', type: 'OrderedCollection' }), {
          status: 200,
          headers: { 'content-type': 'application/ld+json' },
        })
      )

      await derivePageUrl('https://example.com/inbox/', mockFetch)

      expect(mockFetch).toHaveBeenCalledWith(
        'https://example.com/inbox/.meta',
        expect.objectContaining({ method: 'GET' })
      )
    })
  })

  describe('for non-container URLs', () => {
    it('should use direct URL without discovery', async () => {
      mockFetch.mockResolvedValue(
        new Response(JSON.stringify({ id: 'https://example.com/inbox', type: 'OrderedCollection' }), {
          status: 200,
          headers: { 'content-type': 'application/ld+json' },
        })
      )

      await derivePageUrl('https://example.com/inbox', mockFetch)

      expect(mockFetch).toHaveBeenCalledWith(
        'https://example.com/inbox',
        expect.objectContaining({ method: 'GET' })
      )
    })
  })

  describe('when inbox has no first page', () => {
    it('should create a new page and update inbox first', async () => {
      mockFetch.mockResolvedValue(
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
      mockFetch.mockResolvedValue(
        new Response(JSON.stringify({
          id: 'https://example.com/inbox/',
          type: 'OrderedCollection',
          first: existingPage,
        }), {
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
      mockFetch.mockResolvedValue(
        new Response(JSON.stringify({
          id: 'https://example.com/inbox/',
          type: 'OrderedCollection',
          first: 'https://example.com/inbox/pages/1234567890',
        }), {
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
})