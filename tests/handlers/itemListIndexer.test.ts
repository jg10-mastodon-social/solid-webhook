import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { WebhookEvent, ItemListIndexerWebhook } from '../../src/types/index.js'

const mockFetch = vi.fn()
const mockContext = {
  registrations: [{
    handler: 'ItemListIndexer' as const,
    topic: 'https://pod.example.com/tasks/main/',
    indexUrl: 'https://pod.example.com/tasks/index.ttl',
    callback: vi.fn(),
  }],
}

describe('ItemListIndexer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should return false for Remove events', async () => {
    const { handleItemListIndexer } = await import('../../src/handlers/itemListIndexer.js')

    const event: WebhookEvent = {
      type: 'Remove',
      object: 'https://pod.example.com/tasks/main/123.ttl',
      topic: 'https://pod.example.com/tasks/main/',
      raw: {},
    }

    const result = await handleItemListIndexer(event, mockFetch, mockContext as any)
    expect(result).toBe(false)
  })

  it('should fetch task document and extract name and actionStatus', async () => {
    const { handleItemListIndexer } = await import('../../src/handlers/itemListIndexer.js')

    const taskTurtle = `
<#it> a <https://schema.org/Action>;
  <https://schema.org/name> "Test task";
  <https://schema.org/actionStatus> <https://schema.org/PotentialActionStatus>.
`
    const fetchResult = {
      ok: true,
      text: async () => taskTurtle,
    }
    mockFetch.mockResolvedValue(fetchResult as any)

    const event: WebhookEvent = {
      type: 'Add',
      object: 'https://pod.example.com/tasks/main/123.ttl',
      topic: 'https://pod.example.com/tasks/main/',
      raw: {},
    }

    const result = await handleItemListIndexer(event, mockFetch, mockContext as any)
    expect(result).toBe(true)
    expect(mockFetch).toHaveBeenCalledWith(
      'https://pod.example.com/tasks/main/123.ttl',
      expect.objectContaining({ headers: expect.objectContaining({ accept: expect.stringContaining('text/turtle') }) })
    )
  })

  it('should PATCH indexUrl with INSERT DATA', async () => {
    const { handleItemListIndexer } = await import('../../src/handlers/itemListIndexer.js')

    const taskTurtle = `
<#it> a <https://schema.org/Action>;
  <https://schema.org/name> "Test task";
  <https://schema.org/actionStatus> <https://schema.org/PotentialActionStatus>.
`
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => taskTurtle,
    })
    mockFetch.mockResolvedValueOnce({
      ok: true,
    })

    const event: WebhookEvent = {
      type: 'Add',
      object: 'https://pod.example.com/tasks/main/123.ttl',
      topic: 'https://pod.example.com/tasks/main/',
      raw: {},
    }

    const result = await handleItemListIndexer(event, mockFetch, mockContext as any)

    expect(result).toBe(true)
    expect(mockFetch).toHaveBeenCalledTimes(2)
    expect(mockFetch).toHaveBeenLastCalledWith(
      'https://pod.example.com/tasks/index.ttl',
      expect.objectContaining({
        method: 'PATCH',
        headers: expect.objectContaining({
          'content-type': 'application/sparql-update',
        }),
        body: expect.stringContaining('INSERT DATA'),
      })
    )
    const patchBody = mockFetch.mock.calls[1][1].body as string
    expect(patchBody).toContain('https://pod.example.com/tasks/main/123.ttl#it')
    expect(patchBody).toContain('rdfs:label')
    expect(patchBody).toContain('"Test task"')
    expect(patchBody).toContain('schema:itemListElement')
  })
})