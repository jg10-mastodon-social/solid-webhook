import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createPage } from '../../src/services/createPage.js'
import type { SolidFetch } from '../../src/types/index.js'

const mockFetch = vi.fn()

describe('createPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should create a page with correct JSON-LD structure', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(null, { status: 201 })
    )

    const pageUrl = 'https://example.com/inbox/pages/1234567890'
    const inboxUrl = 'https://example.com/inbox/'

    await createPage(pageUrl, inboxUrl, mockFetch)

    expect(mockFetch).toHaveBeenCalledWith(
      pageUrl,
      expect.objectContaining({
        method: 'PUT',
        headers: expect.objectContaining({
          'content-type': 'application/ld+json',
        }),
      })
    )

    const callArgs = mockFetch.mock.calls[0]
    const body = JSON.parse(callArgs[1].body)
    expect(body.id).toBe(pageUrl)
    expect(body.type).toBe('OrderedCollectionPage')
    expect(body.partOf).toBe(inboxUrl)
  })

  it('should throw error if page creation fails', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response('Server error', { status: 500 })
    )

    const pageUrl = 'https://example.com/inbox/pages/1234567890'
    const inboxUrl = 'https://example.com/inbox/'

    await expect(createPage(pageUrl, inboxUrl, mockFetch)).rejects.toThrow(
      /Failed to create page/
    )
  })

  it('should include @context in the page', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(null, { status: 201 })
    )

    const pageUrl = 'https://example.com/inbox/pages/1234567890'
    const inboxUrl = 'https://example.com/inbox/'

    await createPage(pageUrl, inboxUrl, mockFetch)

    const callArgs = mockFetch.mock.calls[0]
    const body = JSON.parse(callArgs[1].body)
    expect(body['@context']).toBe('https://www.w3.org/ns/activitystreams')
  })
})