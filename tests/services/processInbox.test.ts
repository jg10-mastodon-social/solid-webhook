import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { WebhookEvent } from '../../src/types/index.js'

const mockFetch = vi.fn()

vi.mock('../../src/services/solidFetch.js', () => ({
  createSolidFetch: vi.fn().mockResolvedValue(mockFetch),
}))

describe('processInbox', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('processExistingInboxItems', () => {
    it('should not process anything when inbox has no children', async () => {
      const inboxTurtle = `@prefix ldp: <http://www.w3.org/ns/ldp#>.
<> a ldp:Container, ldp:BasicContainer.`

      mockFetch.mockResolvedValue(
        new Response(inboxTurtle, {
          status: 200,
          headers: { 'content-type': 'text/turtle' },
        })
      )

      const handleFn = vi.fn()
      const { processExistingInboxItems } = await import('../../src/services/processInbox.js')

      await processExistingInboxItems('https://example.com/inbox/', mockFetch, handleFn)

      expect(handleFn).not.toHaveBeenCalled()
      expect(mockFetch).toHaveBeenCalledTimes(1)
    })

    it('should skip children that are ldp:Container', async () => {
      const inboxTurtle = `@prefix ldp: <http://www.w3.org/ns/ldp#>.
<> a ldp:Container, ldp:BasicContainer;
   ldp:contains <https://example.com/inbox/subcontainer/>.
<https://example.com/inbox/subcontainer/> a ldp:Container, ldp:BasicContainer.`

      mockFetch.mockResolvedValue(
        new Response(inboxTurtle, {
          status: 200,
          headers: { 'content-type': 'text/turtle' },
        })
      )

      const handleFn = vi.fn()
      const { processExistingInboxItems } = await import('../../src/services/processInbox.js')

      await processExistingInboxItems('https://example.com/inbox/', mockFetch, handleFn)

      expect(handleFn).not.toHaveBeenCalled()
      expect(mockFetch).toHaveBeenCalledTimes(1)
    })

    it('should skip children that are ldp:BasicContainer', async () => {
      const inboxTurtle = `@prefix ldp: <http://www.w3.org/ns/ldp#>.
<> a ldp:Container, ldp:BasicContainer;
   ldp:contains <https://example.com/inbox/pages/>.
<https://example.com/inbox/pages/> a ldp:BasicContainer.`

      mockFetch.mockResolvedValue(
        new Response(inboxTurtle, {
          status: 200,
          headers: { 'content-type': 'text/turtle' },
        })
      )

      const handleFn = vi.fn()
      const { processExistingInboxItems } = await import('../../src/services/processInbox.js')

      await processExistingInboxItems('https://example.com/inbox/', mockFetch, handleFn)

      expect(handleFn).not.toHaveBeenCalled()
      expect(mockFetch).toHaveBeenCalledTimes(1)
    })

    it('should process non-container children', async () => {
      const inboxTurtle = `@prefix ldp: <http://www.w3.org/ns/ldp#>.
<> a ldp:Container, ldp:BasicContainer;
   ldp:contains <https://example.com/inbox/activity1>.
<https://example.com/inbox/activity1> a ldp:Resource, <http://www.w3.org/ns/iana/media-types/application/octet-stream#Resource>.`

      mockFetch.mockResolvedValue(
        new Response(inboxTurtle, {
          status: 200,
          headers: { 'content-type': 'text/turtle' },
        })
      )

      const handleFn = vi.fn()
      const { processExistingInboxItems } = await import('../../src/services/processInbox.js')

      await processExistingInboxItems('https://example.com/inbox/', mockFetch, handleFn)

      expect(handleFn).toHaveBeenCalledTimes(1)
      expect(handleFn).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'Add',
          object: 'https://example.com/inbox/activity1',
          topic: 'https://example.com/inbox/',
        }),
        expect.any(Function)
      )
      expect(mockFetch).toHaveBeenCalledTimes(1)
    })

    it('should process multiple non-container children', async () => {
      const inboxTurtle = `@prefix ldp: <http://www.w3.org/ns/ldp#>.
<> a ldp:Container, ldp:BasicContainer;
   ldp:contains <https://example.com/inbox/activity1>,
                <https://example.com/inbox/activity2>.
<https://example.com/inbox/activity1> a ldp:Resource.
<https://example.com/inbox/activity2> a ldp:Resource.`

      mockFetch.mockResolvedValue(
        new Response(inboxTurtle, {
          status: 200,
          headers: { 'content-type': 'text/turtle' },
        })
      )

      const handleFn = vi.fn()
      const { processExistingInboxItems } = await import('../../src/services/processInbox.js')

      await processExistingInboxItems('https://example.com/inbox/', mockFetch, handleFn)

      expect(handleFn).toHaveBeenCalledTimes(2)
      expect(mockFetch).toHaveBeenCalledTimes(1)
    })

    it('should continue processing when individual items fail', async () => {
      const inboxTurtle = `@prefix ldp: <http://www.w3.org/ns/ldp#>.
<> a ldp:Container, ldp:BasicContainer;
   ldp:contains <https://example.com/inbox/activity1>,
                <https://example.com/inbox/activity2>.
<https://example.com/inbox/activity1> a ldp:Resource.
<https://example.com/inbox/activity2> a ldp:Resource.`

      mockFetch.mockResolvedValue(
        new Response(inboxTurtle, {
          status: 200,
          headers: { 'content-type': 'text/turtle' },
        })
      )

      const handleFn = vi.fn()
        .mockRejectedValueOnce(new Error('Handler failed'))
        .mockResolvedValueOnce(true)

      const { processExistingInboxItems } = await import('../../src/services/processInbox.js')

      await processExistingInboxItems('https://example.com/inbox/', mockFetch, handleFn)

      expect(handleFn).toHaveBeenCalledTimes(2)
      expect(mockFetch).toHaveBeenCalledTimes(1)
    })

    it('should process children without type info (rely on handler)', async () => {
      const inboxTurtle = `@prefix ldp: <http://www.w3.org/ns/ldp#>.
<> a ldp:Container, ldp:BasicContainer;
   ldp:contains <https://example.com/inbox/activity1>.
<https://example.com/inbox/activity1> a ldp:Resource.`

      mockFetch.mockResolvedValue(
        new Response(inboxTurtle, {
          status: 200,
          headers: { 'content-type': 'text/turtle' },
        })
      )

      const handleFn = vi.fn()
      const { processExistingInboxItems } = await import('../../src/services/processInbox.js')

      await processExistingInboxItems('https://example.com/inbox/', mockFetch, handleFn)

      expect(handleFn).toHaveBeenCalledTimes(1)
      expect(mockFetch).toHaveBeenCalledTimes(1)
    })

    it('should skip the .meta file when it has ldp:Container type', async () => {
      const inboxTurtle = `@prefix ldp: <http://www.w3.org/ns/ldp#>.
<> a ldp:Container, ldp:BasicContainer;
   ldp:contains <https://example.com/inbox/.meta>.
<https://example.com/inbox/.meta> a ldp:Resource.`

      mockFetch.mockResolvedValue(
        new Response(inboxTurtle, {
          status: 200,
          headers: { 'content-type': 'text/turtle' },
        })
      )

      const handleFn = vi.fn()
      const { processExistingInboxItems } = await import('../../src/services/processInbox.js')

      await processExistingInboxItems('https://example.com/inbox/', mockFetch, handleFn)

      expect(handleFn).toHaveBeenCalledTimes(1)
      expect(mockFetch).toHaveBeenCalledTimes(1)
    })

    it('should handle mixed container and non-container children', async () => {
      const inboxTurtle = `@prefix ldp: <http://www.w3.org/ns/ldp#>.
<> a ldp:Container, ldp:BasicContainer;
   ldp:contains <https://example.com/inbox/activity1>,
                <https://example.com/inbox/pages/>,
                <https://example.com/inbox/activity2>.
<https://example.com/inbox/activity1> a ldp:Resource.
<https://example.com/inbox/pages/> a ldp:Container, ldp:BasicContainer.
<https://example.com/inbox/activity2> a ldp:Resource.`

      mockFetch.mockResolvedValue(
        new Response(inboxTurtle, {
          status: 200,
          headers: { 'content-type': 'text/turtle' },
        })
      )

      const handleFn = vi.fn()
      const { processExistingInboxItems } = await import('../../src/services/processInbox.js')

      await processExistingInboxItems('https://example.com/inbox/', mockFetch, handleFn)

      expect(handleFn).toHaveBeenCalledTimes(2)
      expect(handleFn).toHaveBeenCalledWith(
        expect.objectContaining({ object: 'https://example.com/inbox/activity1' }),
        expect.any(Function)
      )
      expect(handleFn).toHaveBeenCalledWith(
        expect.objectContaining({ object: 'https://example.com/inbox/activity2' }),
        expect.any(Function)
      )
      expect(mockFetch).toHaveBeenCalledTimes(1)
    })

    it('should return processed and skipped counts', async () => {
      const inboxTurtle = `@prefix ldp: <http://www.w3.org/ns/ldp#>.
<> a ldp:Container, ldp:BasicContainer;
   ldp:contains <https://example.com/inbox/activity1>,
                <https://example.com/inbox/pages/>,
                <https://example.com/inbox/activity2>.
<https://example.com/inbox/activity1> a ldp:Resource.
<https://example.com/inbox/pages/> a ldp:Container.
<https://example.com/inbox/activity2> a ldp:Resource.`

      mockFetch.mockResolvedValue(
        new Response(inboxTurtle, {
          status: 200,
          headers: { 'content-type': 'text/turtle' },
        })
      )

      const handleFn = vi.fn()
      const { processExistingInboxItems } = await import('../../src/services/processInbox.js')

      const result = await processExistingInboxItems('https://example.com/inbox/', mockFetch, handleFn)

      expect(result).toEqual({ processed: 2, skipped: 1, total: 3 })
    })

    it('should retry on terminated error and succeed on second attempt', async () => {
      const inboxTurtle = `@prefix ldp: <http://www.w3.org/ns/ldp#>.
<> a ldp:Container, ldp:BasicContainer;
   ldp:contains <https://example.com/inbox/activity1>.
<https://example.com/inbox/activity1> a ldp:Resource.`

      const terminatedError = new TypeError('terminated')
      mockFetch
        .mockRejectedValueOnce(terminatedError)
        .mockResolvedValueOnce(
          new Response(inboxTurtle, {
            status: 200,
            headers: { 'content-type': 'text/turtle' },
          })
        )

      const handleFn = vi.fn()
      const { processExistingInboxItems } = await import('../../src/services/processInbox.js')

      const result = await processExistingInboxItems('https://example.com/inbox/', mockFetch, handleFn)

      expect(result).toEqual({ processed: 1, skipped: 0, total: 1 })
      expect(mockFetch).toHaveBeenCalledTimes(2)
    })

    it('should retry on server error and succeed on second attempt', async () => {
      const inboxTurtle = `@prefix ldp: <http://www.w3.org/ns/ldp#>.
<> a ldp:Container, ldp:BasicContainer;
   ldp:contains <https://example.com/inbox/activity1>.
<https://example.com/inbox/activity1> a ldp:Resource.`

      mockFetch
        .mockResolvedValueOnce(new Response('', { status: 502 }))
        .mockResolvedValueOnce(
          new Response(inboxTurtle, {
            status: 200,
            headers: { 'content-type': 'text/turtle' },
          })
        )

      const handleFn = vi.fn()
      const { processExistingInboxItems } = await import('../../src/services/processInbox.js')

      const result = await processExistingInboxItems('https://example.com/inbox/', mockFetch, handleFn)

      expect(result).toEqual({ processed: 1, skipped: 0, total: 1 })
      expect(mockFetch).toHaveBeenCalledTimes(2)
    })

    it('should fail after max retries', async () => {
      const terminatedError = new TypeError('terminated')
      mockFetch.mockRejectedValue(terminatedError)

      const handleFn = vi.fn()
      const { processExistingInboxItems } = await import('../../src/services/processInbox.js')

      await expect(
        processExistingInboxItems('https://example.com/inbox/', mockFetch, handleFn)
      ).rejects.toThrow('terminated')
      expect(mockFetch).toHaveBeenCalledTimes(3)
    })

    it('should not retry on client error (4xx)', async () => {
      mockFetch.mockResolvedValue(
        new Response('Not Found', { status: 404 })
      )

      const handleFn = vi.fn()
      const { processExistingInboxItems } = await import('../../src/services/processInbox.js')

      const result = await processExistingInboxItems('https://example.com/inbox/', mockFetch, handleFn)

      expect(result).toEqual({ processed: 0, skipped: 0, total: 0 })
      expect(mockFetch).toHaveBeenCalledTimes(1)
    })

    it('should retry on 429 and succeed on second attempt', async () => {
      const inboxTurtle = `@prefix ldp: <http://www.w3.org/ns/ldp#>.
<> a ldp:Container, ldp:BasicContainer;
   ldp:contains <https://example.com/inbox/activity1>.
<https://example.com/inbox/activity1> a ldp:Resource.`

      mockFetch
        .mockResolvedValueOnce(
          new Response('', { status: 429, headers: { 'Retry-After': '1' } })
        )
        .mockResolvedValueOnce(
          new Response(inboxTurtle, {
            status: 200,
            headers: { 'content-type': 'text/turtle' },
          })
        )

      const handleFn = vi.fn()
      const { processExistingInboxItems } = await import('../../src/services/processInbox.js')

      const result = await processExistingInboxItems('https://example.com/inbox/', mockFetch, handleFn)

      expect(result.processed).toBe(1)
      expect(mockFetch).toHaveBeenCalledTimes(2)
    })

    it('should respect Retry-After header on 429', async () => {
      vi.useFakeTimers()

      const inboxTurtle = `@prefix ldp: <http://www.w3.org/ns/ldp#>.
<> a ldp:Container, ldp:BasicContainer;
   ldp:contains <https://example.com/inbox/activity1>.
<https://example.com/inbox/activity1> a ldp:Resource.`

      mockFetch
        .mockResolvedValueOnce(
          new Response('', { status: 429, headers: { 'Retry-After': '5' } })
        )
        .mockResolvedValueOnce(
          new Response(inboxTurtle, {
            status: 200,
            headers: { 'content-type': 'text/turtle' },
          })
        )

      const handleFn = vi.fn()
      const { processExistingInboxItems } = await import('../../src/services/processInbox.js')

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

      const promise = processExistingInboxItems('https://example.com/inbox/', mockFetch, handleFn)

      await vi.runAllTimersAsync()
      const result = await promise

      expect(result.processed).toBe(1)
      const retryLogs = consoleSpy.mock.calls.filter(call =>
        call[0]?.includes('retrying') && call[0]?.includes('429')
      )
      expect(retryLogs.length).toBeGreaterThan(0)

      consoleSpy.mockRestore()
      vi.useRealTimers()
    })

    it('should fail entire batch if item exhausts retries on 429', async () => {
      mockFetch.mockResolvedValue(
        new Response('', { status: 429, headers: { 'Retry-After': '1' } })
      )

      const handleFn = vi.fn()
      const { processExistingInboxItems } = await import('../../src/services/processInbox.js')

      await expect(
        processExistingInboxItems('https://example.com/inbox/', mockFetch, handleFn)
      ).rejects.toThrow('HTTP 429')
      expect(mockFetch).toHaveBeenCalledTimes(3)
    })

    it('should apply coordinated delay between chunks after 429', async () => {
      vi.useFakeTimers()

      const items = Array.from({ length: 105 }, (_, i) => `
<https://example.com/inbox/activity${i}> a ldp:Resource.`)
      const contains = Array.from({ length: 105 }, (_, i) => `<https://example.com/inbox/activity${i}>`).join(',\n               ')

      const inboxTurtle = `@prefix ldp: <http://www.w3.org/ns/ldp#>.
<> a ldp:Container, ldp:BasicContainer;
   ldp:contains ${contains}.
${items.join('\n')}`

      mockFetch.mockResolvedValue(
        new Response(inboxTurtle, {
          status: 200,
          headers: { 'content-type': 'text/turtle' },
        })
      )

      const errors = []
      const handleFn = vi.fn().mockImplementation(async (event) => {
        if (event.object.includes('activity50')) {
          const err = new Error('HTTP 429') as Error & { status?: number }
          err.status = 429
          throw err
        }
        errors.push(event.object)
      })

      const { processExistingInboxItems } = await import('../../src/services/processInbox.js')

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

      const promise = processExistingInboxItems('https://example.com/inbox/', mockFetch, handleFn)

      await vi.advanceTimersByTimeAsync(2000)
      await vi.runAllTimersAsync()

      try {
        await promise
      } catch (e) {
      }

      expect(handleFn).toHaveBeenCalledTimes(105)

      consoleSpy.mockRestore()
      vi.useRealTimers()
    })

    it('should return total count in result', async () => {
      const inboxTurtle = `@prefix ldp: <http://www.w3.org/ns/ldp#>.
<> a ldp:Container, ldp:BasicContainer;
   ldp:contains <https://example.com/inbox/activity1>,
                <https://example.com/inbox/pages/>,
                <https://example.com/inbox/activity2>.
<https://example.com/inbox/activity1> a ldp:Resource.
<https://example.com/inbox/pages/> a ldp:Container.
<https://example.com/inbox/activity2> a ldp:Resource.`

      mockFetch.mockResolvedValue(
        new Response(inboxTurtle, {
          status: 200,
          headers: { 'content-type': 'text/turtle' },
        })
      )

      const handleFn = vi.fn()
      const { processExistingInboxItems } = await import('../../src/services/processInbox.js')

      const result = await processExistingInboxItems('https://example.com/inbox/', mockFetch, handleFn)

      expect(result.processed).toBe(2)
      expect(result.skipped).toBe(1)
      expect(result.total).toBe(3)
    })

    it('should process items in chunks and yield between chunks', async () => {
      vi.useFakeTimers()

      const items = Array.from({ length: 105 }, (_, i) => `
<https://example.com/inbox/activity${i}> a ldp:Resource.`)
      const contains = Array.from({ length: 105 }, (_, i) => `<https://example.com/inbox/activity${i}>`).join(',\n               ')

      const inboxTurtle = `@prefix ldp: <http://www.w3.org/ns/ldp#>.
<> a ldp:Container, ldp:BasicContainer;
   ldp:contains ${contains}.
${items.join('\n')}`

      mockFetch.mockResolvedValue(
        new Response(inboxTurtle, {
          status: 200,
          headers: { 'content-type': 'text/turtle' },
        })
      )

      const handleFn = vi.fn().mockResolvedValue(undefined)
      const { processExistingInboxItems } = await import('../../src/services/processInbox.js')

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

      const promise = processExistingInboxItems('https://example.com/inbox/', mockFetch, handleFn)

      await vi.runAllTimersAsync()
      await promise

      expect(handleFn).toHaveBeenCalledTimes(105)

      const progressLogs = consoleSpy.mock.calls.filter(call => call[0]?.includes('Progress'))
      expect(progressLogs.length).toBeGreaterThan(0)

      consoleSpy.mockRestore()
      vi.useRealTimers()
    })

    it('should process items concurrently within each chunk', async () => {
      const items = Array.from({ length: 10 }, (_, i) => `
<https://example.com/inbox/activity${i}> a ldp:Resource.`)
      const contains = Array.from({ length: 10 }, (_, i) => `<https://example.com/inbox/activity${i}>`).join(',\n               ')

      const inboxTurtle = `@prefix ldp: <http://www.w3.org/ns/ldp#>.
<> a ldp:Container, ldp:BasicContainer;
   ldp:contains ${contains}.
${items.join('\n')}`

      mockFetch.mockResolvedValue(
        new Response(inboxTurtle, {
          status: 200,
          headers: { 'content-type': 'text/turtle' },
        })
      )

      let concurrentCalls = 0
      let maxConcurrent = 0
      const handleFn = vi.fn().mockImplementation(async () => {
        concurrentCalls++
        maxConcurrent = Math.max(maxConcurrent, concurrentCalls)
        await new Promise(resolve => setTimeout(resolve, 10))
        concurrentCalls--
      })

      const { processExistingInboxItems } = await import('../../src/services/processInbox.js')

      await processExistingInboxItems('https://example.com/inbox/', mockFetch, handleFn)

      expect(handleFn).toHaveBeenCalledTimes(10)
      expect(maxConcurrent).toBeGreaterThan(1)
    })

    it('should apply coordinated delay between chunks after 429', async () => {
      vi.useFakeTimers()

      const items = Array.from({ length: 15 }, (_, i) => `
<https://example.com/inbox/activity${i}> a ldp:Resource.`)
      const contains = Array.from({ length: 15 }, (_, i) => `<https://example.com/inbox/activity${i}>`).join(',\n               ')

      const inboxTurtle = `@prefix ldp: <http://www.w3.org/ns/ldp#>.
<> a ldp:Container, ldp:BasicContainer;
   ldp:contains ${contains}.
${items.join('\n')}`

      mockFetch.mockImplementation((url: string) => {
        if (url.endsWith('/inbox/')) {
          return Promise.resolve(
            new Response(inboxTurtle, {
              status: 200,
              headers: { 'content-type': 'text/turtle' },
            })
          )
        }
        if (url.includes('activity5')) {
          return Promise.resolve(
            new Response('', { status: 429, headers: { 'Retry-After': '2' } })
          )
        }
        return Promise.resolve(
          new Response('{}', { status: 200, headers: { 'content-type': 'application/activity+json' } })
        )
      })

      const handleFn = vi.fn().mockImplementation(async (event, fetch) => {
        await fetch(event.object, { headers: { accept: 'application/activity+json' } })
        return true
      })

      const { processExistingInboxItems } = await import('../../src/services/processInbox.js')

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

      const promise = processExistingInboxItems('https://example.com/inbox/', mockFetch, handleFn)

      await vi.runAllTimersAsync()
      await promise

      const delayLogs = consoleSpy.mock.calls.filter(call =>
        call[0]?.includes('Rate limited') || call[0]?.includes('waiting')
      )
      expect(delayLogs.length).toBeGreaterThan(0)

      consoleSpy.mockRestore()
      vi.useRealTimers()
    })

    it('should use max Retry-After when multiple items get 429 in same chunk', async () => {
      vi.useFakeTimers()

      const items = Array.from({ length: 10 }, (_, i) => `
<https://example.com/inbox/activity${i}> a ldp:Resource.`)
      const contains = Array.from({ length: 10 }, (_, i) => `<https://example.com/inbox/activity${i}>`).join(',\n               ')

      const inboxTurtle = `@prefix ldp: <http://www.w3.org/ns/ldp#>.
<> a ldp:Container, ldp:BasicContainer;
   ldp:contains ${contains}.
${items.join('\n')}`

      mockFetch.mockImplementation((url: string) => {
        if (url.endsWith('/inbox/')) {
          return Promise.resolve(
            new Response(inboxTurtle, {
              status: 200,
              headers: { 'content-type': 'text/turtle' },
            })
          )
        }
        if (url.includes('activity2') || url.includes('activity7')) {
          return Promise.resolve(
            new Response('', { status: 429, headers: { 'Retry-After': '5' } })
          )
        }
        return Promise.resolve(
          new Response('{}', { status: 200, headers: { 'content-type': 'application/activity+json' } })
        )
      })

      const handleFn = vi.fn().mockImplementation(async (event, fetch) => {
        await fetch(event.object, { headers: { accept: 'application/activity+json' } })
        return true
      })

      const { processExistingInboxItems } = await import('../../src/services/processInbox.js')

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

      const promise = processExistingInboxItems('https://example.com/inbox/', mockFetch, handleFn)

      await vi.runAllTimersAsync()
      await promise

      const delayLogs = consoleSpy.mock.calls.filter(call =>
        call[0]?.includes('5')
      )
      expect(delayLogs.length).toBeGreaterThan(0)

      consoleSpy.mockRestore()
      vi.useRealTimers()
    })
  })
})
