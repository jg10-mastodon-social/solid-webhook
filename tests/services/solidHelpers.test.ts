import { describe, it, expect, vi, beforeEach } from 'vitest'
import { discoverMetaResourceUrl } from '../../src/services/solidHelpers.js'

const mockFetch = vi.fn()

describe('solidHelpers', () => {
  describe('discoverMetaResourceUrl', () => {
    beforeEach(() => {
      vi.clearAllMocks()
    })

    it('should return describedby URL from Link header when present', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(null, {
          status: 200,
          headers: {
            'link': '<https://pod.example/inbox/.meta>; rel="describedby"',
          },
        })
      )

      const result = await discoverMetaResourceUrl(
        'https://pod.example/inbox/',
        mockFetch
      )

      expect(result).toBe('https://pod.example/inbox/.meta')
      expect(mockFetch).toHaveBeenCalledWith(
        'https://pod.example/inbox/',
        expect.objectContaining({ method: 'HEAD' })
      )
    })

    it('should fallback to .meta when no describedby in Link header', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(null, {
          status: 200,
          headers: {
            'link': '<https://pod.example/inbox/.acl>; rel="acl"',
          },
        })
      )

      const result = await discoverMetaResourceUrl(
        'https://pod.example/inbox/',
        mockFetch
      )

      expect(result).toBe('https://pod.example/inbox/.meta')
    })

    it('should fallback to .meta when no Link header present', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(null, {
          status: 200,
          headers: {},
        })
      )

      const result = await discoverMetaResourceUrl(
        'https://pod.example/inbox/',
        mockFetch
      )

      expect(result).toBe('https://pod.example/inbox/.meta')
    })

    it('should throw when HEAD request fails', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(null, { status: 401 })
      )

      await expect(
        discoverMetaResourceUrl('https://pod.example/inbox/', mockFetch)
      ).rejects.toThrow(/Failed to discover meta resource/)
    })

    it('should throw when Link header parse fails', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(null, { status: 500 })
      )

      await expect(
        discoverMetaResourceUrl('https://pod.example/inbox/', mockFetch)
      ).rejects.toThrow()
    })
  })
})