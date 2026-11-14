import { describe, it, expect } from 'vitest'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { handleCommitHandler } from '../../src/handlers/commitHandler.js'
import type { SolidFetch, WebhookEvent } from '../../src/types/index.js'

const execFileAsync = promisify(execFile)

const COMMIT_EDITMSG_TOPIC = 'https://pod.example.com/.git/COMMIT_EDITMSG'

function createEvent(): WebhookEvent {
  return {
    type: 'Add',
    topic: COMMIT_EDITMSG_TOPIC,
    object: '',
    raw: {},
  }
}

function createMockFetch(body: string): SolidFetch {
  return async () => new Response(body, { status: 200 })
}

async function git(dir: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', ['-C', dir, ...args])
  return stdout.trim()
}

async function initRepo(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'solid-webhook-commit-'))
  await git(dir, ['init'])
  await git(dir, ['config', 'user.email', 'test@example.com'])
  await git(dir, ['config', 'user.name', 'Solid Webhook Test'])
  return dir
}

describe('CommitHandler (real git)', () => {
  it('commits the work tree changes and leaves it clean', async () => {
    const dir = await initRepo()
    try {
      await writeFile(join(dir, 'note.md'), '# note\n', 'utf-8')
      const message = 'test: integration commit'

      const result = await handleCommitHandler(createEvent(), createMockFetch(message), { gitDir: dir })

      expect(result).toBe(true)
      expect(await git(dir, ['log', '-1', '--pretty=%s'])).toBe(message)
      expect(await git(dir, ['status', '--porcelain'])).toBe('')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('returns true and changes nothing when there is nothing to commit', async () => {
    const dir = await initRepo()
    try {
      await writeFile(join(dir, 'note.md'), '# note\n', 'utf-8')
      expect(
        await handleCommitHandler(createEvent(), createMockFetch('test: first commit'), { gitDir: dir })
      ).toBe(true)
      const before = await git(dir, ['log', '-1', '--pretty=%s'])

      const result = await handleCommitHandler(createEvent(), createMockFetch('test: second commit'), {
        gitDir: dir,
      })

      expect(result).toBe(true)
      expect(await git(dir, ['log', '-1', '--pretty=%s'])).toBe(before)
      expect(await git(dir, ['rev-list', '--count', 'HEAD'])).toBe('1')
      expect(await git(dir, ['status', '--porcelain'])).toBe('')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
