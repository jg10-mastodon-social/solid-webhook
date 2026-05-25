import type { WebhookEvent, SolidFetch } from '../types/index.js'
import { exec } from 'child_process'
import { promisify } from 'util'

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

  try {
    await execAsync(`git --git-dir=${gitDir} add --all .`, { cwd: gitDir })
    await execAsync(`git --git-dir=${gitDir} commit -F - --cleanup=strip`, { cwd: gitDir, input: commitMsg })
    console.log(`Committed changes in: ${gitDir}`)
  } catch (error) {
    console.error(`Git commit failed: ${error}`)
    return false
  }

  return true
}