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

/**
 * Make `git add` hold `.git/index.lock` for a while. Git locks the index before
 * running a clean filter, so an unserialised second `git add` collides with it
 * rather than slipping past. Without this the two runs on a tiny repo usually
 * miss each other and the lock race the serialisation prevents does not
 * reproduce.
 */
async function installSlowIndexFilter(dir: string): Promise<void> {
  await git(dir, ['config', 'filter.slow.clean', 'sleep 0.3; cat'])
  await git(dir, ['config', 'filter.slow.smudge', 'cat'])
  await writeFile(join(dir, '.gitattributes'), 'note.md filter=slow\n', 'utf-8')
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

  it('serialises concurrent commits for the same repo', async () => {
    const dir = await initRepo()
    try {
      // Enough content that a second, unserialised `git add` overlaps the first
      // one's index lock instead of racing past it.
      const lines = Array.from({ length: 20000 }, (_, i) => `line ${i}`)
      await writeFile(join(dir, 'note.md'), `${lines.join('\n')}\n`, 'utf-8')
      await installSlowIndexFilter(dir)

      const [first, second] = await Promise.all([
        handleCommitHandler(createEvent(), createMockFetch('test: first concurrent commit'), {
          gitDir: dir,
        }),
        handleCommitHandler(createEvent(), createMockFetch('test: second concurrent commit'), {
          gitDir: dir,
        }),
      ])

      expect([first, second]).toEqual([true, true])
      expect(await git(dir, ['rev-list', '--count', 'HEAD'])).toBe('1')
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
