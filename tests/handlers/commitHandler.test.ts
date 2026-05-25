import { describe, it, expect, vi, beforeEach } from 'vitest'
import { handleCommitHandler } from '../../src/handlers/commitHandler.js'

const { mockExec } = vi.hoisted(() => {
  return {
    mockExec: vi.fn().mockResolvedValue({ stdout: '', stderr: '' }),
  }
})

vi.mock('child_process', () => ({
  exec: mockExec,
}))

vi.mock('util', () => ({
  promisify: (fn: any) => fn,
}))

describe('CommitHandler', () => {
  beforeEach(() => {
    mockExec.mockClear().mockResolvedValue({ stdout: '', stderr: '' })
  })

  const createMockFetch = (response: Partial<Response> & { body?: string }) => {
    return vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      ...response,
      text: vi.fn().mockResolvedValue(response.body || ''),
    }) as unknown as (url: string | URL | Request, init?: RequestInit) => Promise<Response>
  }

  describe('handleCommitHandler', () => {
    it('should fetch commit message from event.topic', async () => {
      const mockFetch = createMockFetch({ body: 'Initial commit' })

      await handleCommitHandler(
        {
          type: 'Add',
          topic: 'https://pod.example.com/.git/COMMIT_EDITMSG',
          object: '',
          raw: {},
        },
        mockFetch,
        { gitDir: '/repos/myrepo' }
      )

      expect(mockFetch).toHaveBeenCalledWith('https://pod.example.com/.git/COMMIT_EDITMSG')
    })

    it('should return true for Remove events without fetching', async () => {
      const mockFetch = createMockFetch({ body: 'Initial commit' })

      const result = await handleCommitHandler(
        {
          type: 'Remove',
          topic: 'https://pod.example.com/.git/COMMIT_EDITMSG',
          object: '',
          raw: {},
        },
        mockFetch,
        { gitDir: '/repos/myrepo' }
      )

      expect(result).toBe(true)
      expect(mockFetch).not.toHaveBeenCalled()
    })

    it('should return false when no gitDir is provided', async () => {
      const mockFetch = createMockFetch({ body: 'Initial commit' })

      const result = await handleCommitHandler(
        {
          type: 'Add',
          topic: 'https://pod.example.com/.git/COMMIT_EDITMSG',
          object: '',
          raw: {},
        },
        mockFetch,
        {}
      )

      expect(result).toBe(false)
      expect(mockFetch).not.toHaveBeenCalled()
    })

    it('should execute git add and git commit commands', async () => {
      const mockFetch = createMockFetch({ body: 'Initial commit' })

      const result = await handleCommitHandler(
        {
          type: 'Add',
          topic: 'https://pod.example.com/.git/COMMIT_EDITMSG',
          object: '',
          raw: {},
        },
        mockFetch,
        { gitDir: '/repos/myrepo' }
      )

      expect(result).toBe(true)
      expect(mockExec).toHaveBeenCalledTimes(2)
      expect(mockExec).toHaveBeenCalledWith(
        'git --git-dir=/repos/myrepo add --all .',
        expect.any(Object)
      )
    })

    it('should return false when git commit fails', async () => {
      mockExec.mockRejectedValueOnce(new Error('Git failed'))

      const mockFetch = createMockFetch({ body: 'Initial commit' })

      const result = await handleCommitHandler(
        {
          type: 'Add',
          topic: 'https://pod.example.com/.git/COMMIT_EDITMSG',
          object: '',
          raw: {},
        },
        mockFetch,
        { gitDir: '/repos/myrepo' }
      )

      expect(result).toBe(false)
    })
  })
})