import { describe, it, expect, vi, beforeEach } from 'vitest'
import { updateInboxFirst } from '../../src/services/updateInbox.js'
import { discoverMetaResourceUrl } from '../../src/services/solidHelpers.js'

vi.mock('../../src/services/solidHelpers.js', () => ({
  discoverMetaResourceUrl: vi.fn(),
}))

const mockFetch = vi.fn()

describe('updateInboxFirst', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(discoverMetaResourceUrl).mockResolvedValue('https://example.com/inbox/.meta')
  })

  it('should update the inbox first link via meta resource for containers', async () => {
    mockFetch.mockResolvedValue(
      new Response(null, { status: 200 })
    )

    const inboxUrl = 'https://example.com/inbox/'
    const newFirstUrl = 'https://example.com/inbox/pages/1234567890'

    await updateInboxFirst(inboxUrl, newFirstUrl, mockFetch)

    expect(mockFetch).toHaveBeenCalledWith(
      'https://example.com/inbox/.meta',
      expect.objectContaining({
        method: 'PATCH',
        headers: expect.objectContaining({
          'content-type': 'application/sparql-update',
        }),
      })
    )

    const callArgs = mockFetch.mock.calls[0]
    const body = callArgs[1].body
    expect(body).toContain(newFirstUrl)
    expect(body).toContain('as:first')
  })

  it('should throw error if update fails', async () => {
    mockFetch.mockResolvedValue(
      new Response('Server error', { status: 500 })
    )

    const inboxUrl = 'https://example.com/inbox/'
    const newFirstUrl = 'https://example.com/inbox/pages/1234567890'

    await expect(updateInboxFirst(inboxUrl, newFirstUrl, mockFetch)).rejects.toThrow(
      /Failed to update inbox first/
    )
  })

  it('should use SPARQL update format when patching meta resource', async () => {
    mockFetch.mockResolvedValue(
      new Response(null, { status: 200 })
    )

    const inboxUrl = 'https://example.com/inbox/'
    const newFirstUrl = 'https://example.com/inbox/pages/1234567890'

    await updateInboxFirst(inboxUrl, newFirstUrl, mockFetch)

    const callArgs = mockFetch.mock.calls[0]
    const body = callArgs[1].body
    expect(body).toContain('INSERT DATA')
    expect(body).toContain('DELETE DATA')
    expect(body).toContain('WHERE')
  })

  describe('for container URLs', () => {
    it('should discover meta resource URL first', async () => {
      mockFetch.mockResolvedValue(
        new Response(null, { status: 200 })
      )

      const inboxUrl = 'https://example.com/inbox/'
      const newFirstUrl = 'https://example.com/inbox/pages/1234567890'

      await updateInboxFirst(inboxUrl, newFirstUrl, mockFetch)

      expect(discoverMetaResourceUrl).toHaveBeenCalledWith(
        'https://example.com/inbox/',
        mockFetch
      )
    })

    it('should PATCH to discovered meta resource URL', async () => {
      mockFetch.mockResolvedValue(
        new Response(null, { status: 200 })
      )

      const inboxUrl = 'https://example.com/inbox/'
      const newFirstUrl = 'https://example.com/inbox/pages/1234567890'

      await updateInboxFirst(inboxUrl, newFirstUrl, mockFetch)

      expect(mockFetch).toHaveBeenCalledWith(
        'https://example.com/inbox/.meta',
        expect.objectContaining({ method: 'PATCH' })
      )
    })

    it('should throw when discovery fails', async () => {
      vi.mocked(discoverMetaResourceUrl).mockRejectedValue(
        new Error('Discovery failed')
      )

      const inboxUrl = 'https://example.com/inbox/'
      const newFirstUrl = 'https://example.com/inbox/pages/1234567890'

      await expect(
        updateInboxFirst(inboxUrl, newFirstUrl, mockFetch)
      ).rejects.toThrow('Discovery failed')
    })
  })

  describe('for non-container URLs', () => {
    it('should skip discovery and PATCH directly', async () => {
      mockFetch.mockResolvedValue(
        new Response(null, { status: 200 })
      )

      const inboxUrl = 'https://example.com/inbox'
      const newFirstUrl = 'https://example.com/inbox/pages/1234567890'

      await updateInboxFirst(inboxUrl, newFirstUrl, mockFetch)

      expect(discoverMetaResourceUrl).not.toHaveBeenCalled()
      expect(mockFetch).toHaveBeenCalledWith(
        'https://example.com/inbox',
        expect.objectContaining({ method: 'PATCH' })
      )
    })
  })
})