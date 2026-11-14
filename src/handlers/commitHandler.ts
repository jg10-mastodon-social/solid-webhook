import type { WebhookEvent, SolidFetch } from '../types/index.js'
import { exec } from 'child_process'
import { promisify } from 'util'
import { writeFile, unlink } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { setTimeout as delay } from 'timers/promises'

const execAsync = promisify(exec)

const NOTHING_TO_COMMIT = /nothing to commit|nothing added to commit/
const INDEX_LOCK_CONFLICT = /index\.lock/
const MAX_LOCK_ATTEMPTS = 5
const LOCK_RETRY_DELAY_MS = 200

/**
 * Tail of the pending work for each repo. A single write produces two
 * notifications, so two handler runs can start at once; git refuses the second
 * with `Unable to create '.git/index.lock': File exists` and its commit is lost.
 * Runs are chained per gitDir so different repos still commit in parallel.
 */
const repoLocks = new Map<string, Promise<void>>()

function withRepoLock<T>(gitDir: string, task: () => Promise<T>): Promise<T> {
  const previous = repoLocks.get(gitDir) ?? Promise.resolve()
  const result = previous.then(task, task)
  const tail = result.then(
    () => undefined,
    () => undefined
  )
  repoLocks.set(gitDir, tail)
  void tail.then(() => {
    if (repoLocks.get(gitDir) === tail) {
      repoLocks.delete(gitDir)
    }
  })
  return result
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

/**
 * Collect the diagnostic text of a failed git command. `exec` rejects with an
 * error carrying `stdout`, `stderr` and a message that repeats the command.
 */
function gitFailureOutput(error: unknown): string {
  if (error && typeof error === 'object') {
    const { stdout, stderr, message } = error as {
      stdout?: unknown
      stderr?: unknown
      message?: unknown
    }
    return [stdout, stderr, message].filter(isNonEmptyString).join('\n')
  }
  return String(error)
}

/**
 * Run a git command, retrying while another process holds the index lock. The
 * per-repo queue should prevent this, but an external git (a person, a script)
 * can still be mid-operation.
 */
async function execGitWithLockRetry(command: string): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await execAsync(command)
      return
    } catch (error) {
      const output = gitFailureOutput(error)
      if (attempt >= MAX_LOCK_ATTEMPTS || !INDEX_LOCK_CONFLICT.test(output)) {
        throw error
      }
      console.log(
        `[CommitHandler] Index lock busy, retrying (${attempt}/${MAX_LOCK_ATTEMPTS}): ${command}`
      )
      await delay(LOCK_RETRY_DELAY_MS)
    }
  }
}

async function commitWorkTree(gitDir: string, commitMsg: string): Promise<boolean> {
  const tempFile = join(tmpdir(), `commit-msg-${Date.now()}.txt`)
  try {
    await writeFile(tempFile, commitMsg, 'utf-8')
    try {
      await execGitWithLockRetry(`git -C "${gitDir}" add --all .`)
      await execGitWithLockRetry(`git -C "${gitDir}" commit -F "${tempFile}" --cleanup=strip`)
      console.log(`[CommitHandler] Committed changes in: ${gitDir}`)
      return true
    } catch (error) {
      const output = gitFailureOutput(error)
      if (NOTHING_TO_COMMIT.test(output)) {
        console.log(`[CommitHandler] Nothing to commit in: ${gitDir}`)
        return true
      }
      throw error
    }
  } finally {
    try {
      await unlink(tempFile)
    } catch {
      // ignore cleanup error
    }
  }
}

export async function handleCommitHandler(
  event: WebhookEvent,
  fetch: SolidFetch,
  context?: { gitDir?: string }
): Promise<boolean> {
  console.log(`[CommitHandler] ${event.type} event for ${event.object}`)

  if (event.type === 'Remove') {
    console.log('[CommitHandler] Remove event, skipping')
    return true
  }

  if (!context?.gitDir) {
    console.error('[CommitHandler] Error: No gitDir provided')
    return false
  }

  const commitMsgUrl = event.topic

  let commitSuccess = false
  try {
    const response = await fetch(commitMsgUrl)
    if (!response.ok) {
      console.error(`[CommitHandler] Error: Failed to fetch commit message: ${response.status}`)
      return false
    }

    const commitMsg = await response.text()
    const gitDir = context.gitDir

    commitSuccess = await withRepoLock(gitDir, () => commitWorkTree(gitDir, commitMsg))
  } catch (error) {
    console.error(`[CommitHandler] Error: Git commit failed: ${error}`)
  }

  console.log(`[CommitHandler] completed: ${commitSuccess}`)
  return commitSuccess
}
