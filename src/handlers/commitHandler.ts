import type { WebhookEvent, SolidFetch } from '../types/index.js'
import { exec } from 'child_process'
import { promisify } from 'util'
import { writeFile, unlink } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'

const execAsync = promisify(exec)

const NOTHING_TO_COMMIT = /nothing to commit|nothing added to commit/

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

    const tempFile = join(tmpdir(), `commit-msg-${Date.now()}.txt`)
    try {
      await writeFile(tempFile, commitMsg, 'utf-8')
      try {
        await execAsync(`git -C "${gitDir}" add --all .`)
        await execAsync(`git -C "${gitDir}" commit -F "${tempFile}" --cleanup=strip`)
        console.log(`[CommitHandler] Committed changes in: ${gitDir}`)
        commitSuccess = true
      } catch (error) {
        const output = gitFailureOutput(error)
        if (NOTHING_TO_COMMIT.test(output)) {
          console.log(`[CommitHandler] Nothing to commit in: ${gitDir}`)
          commitSuccess = true
        } else {
          throw error
        }
      }
    } finally {
      try {
        await unlink(tempFile)
      } catch {
        // ignore cleanup error
      }
    }
  } catch (error) {
    console.error(`[CommitHandler] Error: Git commit failed: ${error}`)
  }

  console.log(`[CommitHandler] completed: ${commitSuccess}`)
  return commitSuccess
}