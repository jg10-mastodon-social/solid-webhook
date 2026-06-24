import { describe, it, expect, vi, beforeEach } from 'vitest'
import { updatePageNext } from '../../src/services/updatePageNext.js'

const mockFetch = vi.fn()

describe('updatePageNext', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should add as:next link to the page via PATCH', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(null, { status: 200 })
    )

    const pageUrl = 'https://example.com/inbox/pages/1234567890'
    const nextUrl = 'https://example.com/inbox/pages/1234567891'

    await updatePageNext(pageUrl, nextUrl, mockFetch)

    expect(mockFetch).toHaveBeenCalledWith(
      pageUrl,
      expect.objectContaining({
        method: 'PATCH',
        headers: expect.objectContaining({
          'content-type': 'application/sparql-update',
        }),
      })
    )

    const callArgs = mockFetch.mock.calls[0]
    const body = callArgs[1].body as string
    expect(body).toContain('as:next')
    expect(body).toContain(nextUrl)
    expect(body).toContain(pageUrl)
  })

  it('should throw error if PATCH fails', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response('Server error', { status: 500 })
    )

    const pageUrl = 'https://example.com/inbox/pages/1234567890'
    const nextUrl = 'https://example.com/inbox/pages/1234567891'

    await expect(updatePageNext(pageUrl, nextUrl, mockFetch)).rejects.toThrow(
      /Failed to update page next/
    )
  })

  it('should use SPARQL UPDATE format', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(null, { status: 200 })
    )

    const pageUrl = 'https://example.com/inbox/pages/1234567890'
    const nextUrl = 'https://example.com/inbox/pages/1234567891'

    await updatePageNext(pageUrl, nextUrl, mockFetch)

    const callArgs = mockFetch.mock.calls[0]
    const body = callArgs[1].body as string
    expect(body).toContain('INSERT DATA')
  })

  it('should handle URLs with percent signs', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(null, { status: 200 })
    )

    const pageUrl = 'https://example.com/inbox/Icon%20Water/pages/1234567890'
    const nextUrl = 'https://example.com/inbox/Icon%20Water/pages/1234567891'

    await updatePageNext(pageUrl, nextUrl, mockFetch)

    const callArgs = mockFetch.mock.calls[0]
    const body = callArgs[1].body as string
    expect(body).toContain('Icon%20Water')
  })
})