import { describe, it, expect, vi, beforeEach } from 'vitest'
import { persistInboxItem } from '../../src/services/persistInbox.js'
import { activityToTurtle } from '../../src/services/activityToRdf.js'
import { buildInsertDeletePatch } from '../../src/services/buildPatch.js'

const mockFetch = vi.fn()

vi.mock('../../src/services/activityToRdf.js', () => ({
  activityToTurtle: vi.fn().mockReturnValue('<activity> <prop> "value" .'),
  skolemizeBlankNodes: vi.fn().mockImplementation((turtle) => turtle),
}))

vi.mock('../../src/services/buildPatch.js', () => ({
  buildInsertDeletePatch: vi.fn().mockReturnValue('@prefix as: <https://www.w3.org/ns/activitystreams#>. _:patch a solid:InsertDeletePatch .'),
}))

describe('persistInboxItem', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should persist an activity to the page', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(null, { status: 200 })
    )

    const activity = {
      type: 'Create',
      id: 'https://example.com/activities/1',
      actor: 'https://example.com/actor/#me',
    }
    const pageUrl = 'https://example.com/inbox/pages/1234567890'
    const skolemizeBase = 'https://example.com/.well-known/genid/'

    await persistInboxItem(activity, pageUrl, mockFetch, { skolemizeBase })

    expect(mockFetch).toHaveBeenCalledWith(
      pageUrl,
      expect.objectContaining({
        method: 'PATCH',
        headers: expect.objectContaining({
          'content-type': 'text/n3',
        }),
      })
    )
  })

  it('should throw error when PATCH fails', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response('Server error', { status: 500 })
    )

    const activity = { type: 'Create', id: 'https://example.com/activities/1' }
    const pageUrl = 'https://example.com/inbox/pages/1234567890'
    const skolemizeBase = 'https://example.com/.well-known/genid/'

    await expect(
      persistInboxItem(activity, pageUrl, mockFetch, { skolemizeBase })
    ).rejects.toThrow(/Failed to persist inbox item/)
  })

  it('should use custom skolemizeBase if provided', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(null, { status: 200 })
    )

    const activity = { type: 'Create', id: 'https://example.com/activities/1' }
    const pageUrl = 'https://example.com/inbox/pages/1234567890'
    const customSkolemizeBase = 'https://custom.example/.well-known/genid/'

    await persistInboxItem(activity, pageUrl, mockFetch, { skolemizeBase: customSkolemizeBase })

    expect(mockFetch).toHaveBeenCalled()
  })

  it('should generate item ID from activity.id if available', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(null, { status: 200 })
    )

    const activity = {
      type: 'Create',
      id: 'https://example.com/activities/123',
    }
    const pageUrl = 'https://example.com/inbox/pages/1234567890'
    const skolemizeBase = 'https://example.com/.well-known/genid/'

    await persistInboxItem(activity, pageUrl, mockFetch, { skolemizeBase })

    expect(buildInsertDeletePatch).toHaveBeenCalledWith(
      expect.any(String),
      'https://example.com/activities/123',
      pageUrl
    )
  })

  it('should generate fallback item ID if activity.id is missing', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(null, { status: 200 })
    )

    const activity = {
      type: 'Create',
    }
    const pageUrl = 'https://example.com/inbox/pages/1234567890'
    const skolemizeBase = 'https://example.com/.well-known/genid/'

    await persistInboxItem(activity, pageUrl, mockFetch, { skolemizeBase })

    expect(buildInsertDeletePatch).toHaveBeenCalledWith(
      expect.any(String),
      expect.stringContaining('https://example.com/.well-known/genid/'),
      pageUrl
    )
  })
})