import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SolidFetch } from '../../src/types/index.js'

const mockFetch = vi.fn().mockResolvedValue(
  new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
)

vi.mock('@soid/koa', () => ({
  getAuthenticatedFetch: vi.fn().mockResolvedValue(mockFetch),
}))

describe('SolidFetch Service', () => {
  describe('createSolidFetch', () => {
    it('should create a solid fetch for the given webId', async () => {
      const { createSolidFetch } = await import('../../src/services/solidFetch.js')
      const fetch = await createSolidFetch(
        'https://pod.example.com/profile/card#me',
        'https://pod.example.com'
      )
      expect(fetch).toBeDefined()
      expect(typeof fetch).toBe('function')
    })

    it('should throw if webId is missing', async () => {
      const { createSolidFetch } = await import('../../src/services/solidFetch.js')
      await expect(
        createSolidFetch('', 'https://pod.example.com')
      ).rejects.toThrow('webId is required')
    })

    it('should throw if issuer is missing', async () => {
      const { createSolidFetch } = await import('../../src/services/solidFetch.js')
      await expect(
        createSolidFetch('https://pod.example.com/profile/card#me', '')
      ).rejects.toThrow('issuer is required')
    })

    it('should throw if issuer does not match webId origin', async () => {
      const { createSolidFetch } = await import('../../src/services/solidFetch.js')
      await expect(
        createSolidFetch('https://pod.example.com/profile/card#me', 'https://other.example.com')
      ).rejects.toThrow('Issuer origin must match webId origin')
    })
  })

  describe('solidFetch usage', () => {
    it('should make authenticated requests', async () => {
      const { createSolidFetch } = await import('../../src/services/solidFetch.js')
      const fetch = await createSolidFetch(
        'https://pod.example.com/profile/card#me',
        'https://pod.example.com'
      )

      const response = await fetch('https://pod.example.com/inbox/')
      expect(response.ok).toBe(true)
      expect(mockFetch).toHaveBeenCalled()
    })
  })
})
