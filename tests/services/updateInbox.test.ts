import { describe, it, expect, vi, beforeEach } from 'vitest'
import { updateInboxFirst } from '../../src/services/updateInbox.js'

const mockFetch = vi.fn()

describe('updateInboxFirst', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should update the inbox first link', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(null, { status: 200 })
    )

    const inboxUrl = 'https://example.com/inbox/'
    const newFirstUrl = 'https://example.com/inbox/pages/1234567890'

    await updateInboxFirst(inboxUrl, newFirstUrl, mockFetch)

    expect(mockFetch).toHaveBeenCalledWith(
      inboxUrl,
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
    mockFetch.mockResolvedValueOnce(
      new Response('Server error', { status: 500 })
    )

    const inboxUrl = 'https://example.com/inbox/'
    const newFirstUrl = 'https://example.com/inbox/pages/1234567890'

    await expect(updateInboxFirst(inboxUrl, newFirstUrl, mockFetch)).rejects.toThrow(
      /Failed to update inbox first/
    )
  })

  it('should use SPARQL update format', async () => {
    mockFetch.mockResolvedValueOnce(
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
})