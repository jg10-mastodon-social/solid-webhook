import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { WebhookEvent, SolidFetch } from '../../src/types/index.js'

const mockFetch = vi.fn()

vi.mock('../../src/services/solidFetch.js', () => ({
  createSolidFetch: vi.fn().mockResolvedValue(mockFetch),
}))

vi.mock('../../src/services/derivePageUrl.js', () => ({
  derivePageUrl: vi.fn().mockResolvedValue('https://pod.example.com/inbox/pages/1234567890'),
}))

vi.mock('../../src/services/persistInbox.js', () => ({
  persistInboxItem: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../../src/services/updateInboxItem.js', () => ({
  updateInboxItem: vi.fn().mockResolvedValue(undefined),
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

    it('should persist and delete processed item from inbox', async () => {
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

      const deleteCalls = mockFetch.mock.calls.filter(
        call => call[1]?.method === 'DELETE'
      )
      expect(deleteCalls).toHaveLength(1)
      expect(deleteCalls[0][0]).toBe('https://pod.example.com/activities/123')
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

      const result = await handleInboxModified(event, mockFetch)

      expect(result).toBe(true)
    })

    it('should call derivePageUrl and persistInboxItem', async () => {
      const activityDoc = JSON.stringify({
        type: 'Create',
        id: 'https://pod.example.com/activities/123',
        actor: 'https://pod.example.com/actor/#me',
      })

      mockFetch.mockResolvedValue(
        new Response(activityDoc, {
          status: 200,
          headers: { 'content-type': 'application/activity+json' },
        })
      )

      const { handleInboxModified } = await import('../../src/handlers/inboxModified.js')
      const { derivePageUrl } = await import('../../src/services/derivePageUrl.js')
      const { persistInboxItem } = await import('../../src/services/persistInbox.js')

      const event: WebhookEvent = {
        type: 'Add',
        object: 'https://pod.example.com/activities/123',
        topic: 'https://pod.example.com/inbox/',
        raw: { type: 'Add', object: 'https://pod.example.com/activities/123' },
      }

      await handleInboxModified(event, mockFetch)

      expect(derivePageUrl).toHaveBeenCalledWith(
        'https://pod.example.com/inbox/',
        mockFetch
      )
      expect(persistInboxItem).toHaveBeenCalled()
    })

    it('should not persist Delete activities but still delete from inbox', async () => {
      const activityDoc = JSON.stringify({
        type: 'Delete',
        id: 'https://pod.example.com/activities/456',
        actor: 'https://pod.example.com/actor/#me',
        object: 'https://pod.example.com/activities/123',
      })

      mockFetch.mockResolvedValue(
        new Response(activityDoc, {
          status: 200,
          headers: { 'content-type': 'application/activity+json' },
        })
      )

      const { handleInboxModified } = await import('../../src/handlers/inboxModified.js')
      const { derivePageUrl } = await import('../../src/services/derivePageUrl.js')
      const { persistInboxItem } = await import('../../src/services/persistInbox.js')

      const event: WebhookEvent = {
        type: 'Add',
        object: 'https://pod.example.com/activities/456',
        topic: 'https://pod.example.com/inbox/',
        raw: { type: 'Add', object: 'https://pod.example.com/activities/456' },
      }

      const result = await handleInboxModified(event, mockFetch)

      expect(result).toBe(true)
      expect(derivePageUrl).not.toHaveBeenCalled()
      expect(persistInboxItem).not.toHaveBeenCalled()
      const deleteCalls = mockFetch.mock.calls.filter(
        call => call[1]?.method === 'DELETE'
      )
      expect(deleteCalls).toHaveLength(1)
      expect(deleteCalls[0][0]).toBe('https://pod.example.com/activities/456')
    })

    it('should continue even if persist fails', async () => {
      const activityDoc = JSON.stringify({
        type: 'Create',
        id: 'https://pod.example.com/activities/123',
        actor: 'https://pod.example.com/actor/#me',
      })

      mockFetch.mockResolvedValue(
        new Response(activityDoc, {
          status: 200,
          headers: { 'content-type': 'application/activity+json' },
        })
      )

      vi.mock('../../src/services/persistInbox.js', () => ({
        persistInboxItem: vi.fn().mockRejectedValue(new Error('Persist failed')),
      }))

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

    describe('ActivityPub Update activity handling', () => {
      it('should call updateInboxItem when activity type is Update', async () => {
        const activityDoc = JSON.stringify({
          type: 'Update',
          id: 'https://pod.example.com/activities/789',
          actor: 'https://pod.example.com/actor/#me',
          object: {
            id: 'https://pod.example.com/notes/123',
            type: 'Note',
            content: 'Updated content',
          },
        })

        mockFetch.mockResolvedValue(
          new Response(activityDoc, {
            status: 200,
            headers: { 'content-type': 'application/activity+json' },
          })
        )

        const { handleInboxModified } = await import('../../src/handlers/inboxModified.js')
        const { updateInboxItem } = await import('../../src/services/updateInboxItem.js')

        const event: WebhookEvent = {
          type: 'Add',
          object: 'https://pod.example.com/activities/789',
          topic: 'https://pod.example.com/inbox/',
          raw: { type: 'Add', object: 'https://pod.example.com/activities/789' },
        }

        await handleInboxModified(event, mockFetch)

        expect(updateInboxItem).toHaveBeenCalledWith(
          expect.objectContaining({
            id: 'https://pod.example.com/notes/123',
            type: 'Note',
            content: 'Updated content',
          }),
          'https://pod.example.com/notes/123',
          'https://pod.example.com/inbox/',
          mockFetch,
          expect.any(Object)
        )
      })

      it('should delete Update activity from source after processing', async () => {
        const activityDoc = JSON.stringify({
          type: 'Update',
          id: 'https://pod.example.com/activities/789',
          actor: 'https://pod.example.com/actor/#me',
          object: {
            id: 'https://pod.example.com/notes/123',
            type: 'Note',
            content: 'Updated content',
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
          object: 'https://pod.example.com/activities/789',
          topic: 'https://pod.example.com/inbox/',
          raw: { type: 'Add', object: 'https://pod.example.com/activities/789' },
        }

        await handleInboxModified(event, mockFetch)

        const deleteCalls = mockFetch.mock.calls.filter(
          call => call[1]?.method === 'DELETE'
        )
        expect(deleteCalls).toHaveLength(1)
        expect(deleteCalls[0][0]).toBe('https://pod.example.com/activities/789')
      })

      it('should persist object as new item if target does not exist', async () => {
        const activityDoc = JSON.stringify({
          type: 'Update',
          id: 'https://pod.example.com/activities/789',
          actor: 'https://pod.example.com/actor/#me',
          object: {
            id: 'https://pod.example.com/notes/999',
            type: 'Note',
            content: 'New note from update',
          },
        })

        mockFetch.mockResolvedValue(
          new Response(activityDoc, {
            status: 200,
            headers: { 'content-type': 'application/activity+json' },
          })
        )

        const { handleInboxModified } = await import('../../src/handlers/inboxModified.js')
        const { updateInboxItem } = await import('../../src/services/updateInboxItem.js')
        const { persistInboxItem } = await import('../../src/services/persistInbox.js')

        const event: WebhookEvent = {
          type: 'Add',
          object: 'https://pod.example.com/activities/789',
          topic: 'https://pod.example.com/inbox/',
          raw: { type: 'Add', object: 'https://pod.example.com/activities/789' },
        }

        await handleInboxModified(event, mockFetch)

        expect(updateInboxItem).toHaveBeenCalled()
        expect(persistInboxItem).not.toHaveBeenCalled()
      })

      it('should skip Update activity when origins do not match', async () => {
        const activityDoc = JSON.stringify({
          type: 'Update',
          id: 'https://pod.example.com/activities/789',
          actor: 'https://pod.example.com/actor/#me',
          object: {
            id: 'https://other-server.example/notes/123',
            type: 'Note',
            content: 'Updated content',
          },
        })

        mockFetch.mockResolvedValue(
          new Response(activityDoc, {
            status: 200,
            headers: { 'content-type': 'application/activity+json' },
          })
        )

        const { handleInboxModified } = await import('../../src/handlers/inboxModified.js')
        const { updateInboxItem } = await import('../../src/services/updateInboxItem.js')
        const { persistInboxItem } = await import('../../src/services/persistInbox.js')

        const event: WebhookEvent = {
          type: 'Add',
          object: 'https://pod.example.com/activities/789',
          topic: 'https://pod.example.com/inbox/',
          raw: { type: 'Add', object: 'https://pod.example.com/activities/789' },
        }

        const result = await handleInboxModified(event, mockFetch)

        expect(result).toBe(false)
        expect(updateInboxItem).not.toHaveBeenCalled()
        expect(persistInboxItem).not.toHaveBeenCalled()
      })

      it('should still delete Update activity from source even when skipped due to origin mismatch', async () => {
        const activityDoc = JSON.stringify({
          type: 'Update',
          id: 'https://pod.example.com/activities/789',
          actor: 'https://pod.example.com/actor/#me',
          object: {
            id: 'https://other-server.example/notes/123',
            type: 'Note',
            content: 'Updated content',
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
          object: 'https://pod.example.com/activities/789',
          topic: 'https://pod.example.com/inbox/',
          raw: { type: 'Add', object: 'https://pod.example.com/activities/789' },
        }

        await handleInboxModified(event, mockFetch)

        const deleteCalls = mockFetch.mock.calls.filter(
          call => call[1]?.method === 'DELETE'
        )
        expect(deleteCalls).toHaveLength(1)
        expect(deleteCalls[0][0]).toBe('https://pod.example.com/activities/789')
      })
    })
  })
})
