import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getPageInfo, PAGE_SIZE_LIMIT } from '../../src/services/getPageInfo.js'

const mockFetch = vi.fn()

describe('getPageInfo', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('itemCount', () => {
    it('should return 0 for empty items array', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ items: [] }), {
          status: 200,
          headers: { 'content-type': 'application/ld+json' },
        })
      )

      const info = await getPageInfo('https://example.com/inbox/pages/1', mockFetch)
      expect(info.itemCount).toBe(0)
    })

    it('should return count of items', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({
          items: [
            'https://example.com/activities/1',
            'https://example.com/activities/2',
            'https://example.com/activities/3',
          ],
        }), {
          status: 200,
          headers: { 'content-type': 'application/ld+json' },
        })
      )

      const info = await getPageInfo('https://example.com/inbox/pages/1', mockFetch)
      expect(info.itemCount).toBe(3)
    })

    it('should handle orderedItems', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({
          orderedItems: [
            { id: 'https://example.com/activities/1' },
            { id: 'https://example.com/activities/2' },
          ],
        }), {
          status: 200,
          headers: { 'content-type': 'application/ld+json' },
        })
      )

      const info = await getPageInfo('https://example.com/inbox/pages/1', mockFetch)
      expect(info.itemCount).toBe(2)
    })
  })

  describe('isFull', () => {
    it('should return false when under page size limit', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({
          items: Array(PAGE_SIZE_LIMIT - 1).fill('https://example.com/activity'),
        }), {
          status: 200,
          headers: { 'content-type': 'application/ld+json' },
        })
      )

      const info = await getPageInfo('https://example.com/inbox/pages/1', mockFetch)
      expect(info.isFull).toBe(false)
    })

    it('should return true when at page size limit', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({
          items: Array(PAGE_SIZE_LIMIT).fill('https://example.com/activity'),
        }), {
          status: 200,
          headers: { 'content-type': 'application/ld+json' },
        })
      )

      const info = await getPageInfo('https://example.com/inbox/pages/1', mockFetch)
      expect(info.isFull).toBe(true)
    })

    it('should return false for empty page (no items)', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({}), {
          status: 200,
          headers: { 'content-type': 'application/ld+json' },
        })
      )

      const info = await getPageInfo('https://example.com/inbox/pages/1', mockFetch)
      expect(info.isFull).toBe(false)
    })
  })

  describe('error handling', () => {
    it('should return empty info for 404 (page does not exist)', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(null, { status: 404 })
      )

      const info = await getPageInfo('https://example.com/inbox/pages/999', mockFetch)
      expect(info.itemCount).toBe(0)
      expect(info.isFull).toBe(false)
    })

    it('should throw for other errors', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(null, { status: 500 })
      )

      await expect(
        getPageInfo('https://example.com/inbox/pages/1', mockFetch)
      ).rejects.toThrow(/Failed to fetch page/)
    })
  })
})