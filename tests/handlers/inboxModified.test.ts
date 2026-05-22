import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { WebhookEvent, SolidFetch } from '../../src/types/index.js'

const mockFetch = vi.fn()

vi.mock('../../src/services/solidFetch.js', () => ({
  createSolidFetch: vi.fn().mockResolvedValue(mockFetch),
}))

describe('InboxModified Handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('handleInboxModified', () => {
    it('should ignore Remove events', async () => {
      mockFetch.mockResolvedValue(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      )

      const { handleInboxModified } = await import('../../src/handlers/inboxModified.js')
      
      const event: WebhookEvent = {
        type: 'Remove',
        object: 'https://pod.example.com/activities/123',
        topic: 'https://pod.example.com/inbox/',
        raw: { type: 'Remove', object: 'https://pod.example.com/activities/123' },
      }

      const result = await handleInboxModified(event, mockFetch)

      expect(result).toBe(false)
      expect(mockFetch).not.toHaveBeenCalled()
    })

    it('should fetch the activity document', async () => {
      const activityDoc = JSON.stringify({
        type: 'Create',
        id: 'https://pod.example.com/activities/123',
        actor: 'https://pod.example.com/actor/#me',
        object: {
          type: 'Note',
          content: 'Hello world',
        },
      })

      mockFetch.mockResolvedValue(
        new Response(activityDoc, {
          status: 200,
          headers: { 'content-type': 'application/activity+json' },
        })
      )

      const { handleInboxModified } = await import('../../src/handlers/inboxModified.js')
      
      const event: WebhookEvent = {
        type: 'Add',
        object: 'https://pod.example.com/activities/123',
        topic: 'https://pod.example.com/inbox/',
        raw: { type: 'Add', object: 'https://pod.example.com/activities/123' },
      }

      await handleInboxModified(event, mockFetch)

      expect(mockFetch).toHaveBeenCalledWith(
        'https://pod.example.com/activities/123',
        expect.objectContaining({ method: 'GET' })
      )
    })

    it('should delete processed item from inbox', async () => {
      const activityDoc = JSON.stringify({
        type: 'Create',
        id: 'https://pod.example.com/activities/123',
        actor: 'https://pod.example.com/actor/#me',
        object: {
          type: 'Note',
          content: 'Hello world',
        },
      })

      mockFetch
        .mockResolvedValueOnce(
          new Response(activityDoc, {
            status: 200,
            headers: { 'content-type': 'application/activity+json' },
          })
        )
        .mockResolvedValueOnce(
          new Response(null, { status: 204 })
        )

      const { handleInboxModified } = await import('../../src/handlers/inboxModified.js')
      
      const event: WebhookEvent = {
        type: 'Add',
        object: 'https://pod.example.com/activities/123',
        topic: 'https://pod.example.com/inbox/',
        raw: { type: 'Add', object: 'https://pod.example.com/activities/123' },
      }

      await handleInboxModified(event, mockFetch)

      expect(mockFetch).toHaveBeenCalledTimes(2)
      expect(mockFetch).toHaveBeenLastCalledWith(
        'https://pod.example.com/activities/123',
        expect.objectContaining({ method: 'DELETE' })
      )
    })

    it('should return false for Remove events', async () => {
      const { handleInboxModified } = await import('../../src/handlers/inboxModified.js')
      
      const event: WebhookEvent = {
        type: 'Remove',
        object: 'https://pod.example.com/activities/123',
        topic: 'https://pod.example.com/inbox/',
        raw: { type: 'Remove', object: 'https://pod.example.com/activities/123' },
      }

      const result = await handleInboxModified(event, mockFetch)

      expect(result).toBe(false)
    })

    it('should return true for processed Add events', async () => {
      const activityDoc = JSON.stringify({
        type: 'Create',
        id: 'https://pod.example.com/activities/123',
        actor: 'https://pod.example.com/actor/#me',
        object: {
          type: 'Note',
          content: 'Hello world',
        },
      })

      mockFetch
        .mockResolvedValueOnce(
          new Response(activityDoc, {
            status: 200,
            headers: { 'content-type': 'application/activity+json' },
          })
        )
        .mockResolvedValueOnce(
          new Response(null, { status: 204 })
        )

      const { handleInboxModified } = await import('../../src/handlers/inboxModified.js')
      
      const event: WebhookEvent = {
        type: 'Add',
        object: 'https://pod.example.com/activities/123',
        topic: 'https://pod.example.com/inbox/',
        raw: { type: 'Add', object: 'https://pod.example.com/activities/123' },
      }

      const result = await handleInboxModified(event, mockFetch)

      expect(result).toBe(true)
    })
  })
})
