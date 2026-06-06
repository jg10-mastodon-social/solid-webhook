import type { WebhookEvent, SolidFetch } from '../types/index.js'
import { exec } from 'child_process'
import { promisify } from 'util'
import { writeFile, unlink } from 'fs/promises'
import { join } from 'path'

const execAsync = promisify(exec)

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

    const tempFile = join('/tmp', `commit-msg-${Date.now()}.txt`)
    try {
      await writeFile(tempFile, commitMsg, 'utf-8')
      await execAsync(`git --git-dir=${gitDir} add --all .`, { cwd: gitDir })
      await execAsync(`git --git-dir=${gitDir} commit -F "${tempFile}" --cleanup=strip`, { cwd: gitDir })
      console.log(`[CommitHandler] Committed changes in: ${gitDir}`)
      commitSuccess = true
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