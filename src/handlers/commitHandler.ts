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
  if (event.type === 'Remove') {
    return true
  }

  if (!context?.gitDir) {
    console.error('No gitDir provided')
    return false
  }

  const commitMsgUrl = event.topic
  console.log(`Fetching commit message from: ${commitMsgUrl}`)

  const response = await fetch(commitMsgUrl)
  if (!response.ok) {
    console.error(`Failed to fetch commit message: ${response.status}`)
    return false
  }

  const commitMsg = await response.text()
  const gitDir = context.gitDir

  const tempFile = join('/tmp', `commit-msg-${Date.now()}.txt`)
  try {
    await writeFile(tempFile, commitMsg, 'utf-8')
    await execAsync(`git --git-dir=${gitDir} add --all .`, { cwd: gitDir })
    await execAsync(`git --git-dir=${gitDir} commit -F "${tempFile}" --cleanup=strip`, { cwd: gitDir })
    console.log(`Committed changes in: ${gitDir}`)
  } catch (error) {
    console.error(`Git commit failed: ${error}`)
    return false
  } finally {
    try {
      await unlink(tempFile)
    } catch {
      // ignore cleanup error
    }
  }

  return true
}