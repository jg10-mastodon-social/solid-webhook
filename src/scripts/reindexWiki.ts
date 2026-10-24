import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  buildExpectedLabels,
  discoverLocalMarkdown,
  mergeLabelIndex,
} from '../services/wikiIndexFile.js'

export interface ReindexArgs {
  wiki: string
  podUrl?: string
  solidData: string
  indexUrl?: string
  index?: string
  maxDepth: number
  check: boolean
  write: boolean
  json: boolean
  includeStorageSuffix: boolean
  followSymlinks: boolean
  help: boolean
}

export interface ResolvedWikiPaths {
  wikiRootUrl: string
  localDir: string
  indexUrl: string
  indexPath: string
}

export interface ReindexResult extends ResolvedWikiPaths {
  fileCount: number
  changed: boolean
  wrote: boolean
  added: string[]
  removed: string[]
  updated: Array<{ subject: string; from: string; to: string }>
}

function isPodUrl(value: string): boolean {
  return /^https?:\/\//i.test(value)
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith('/') ? value : `${value}/`
}

function expandHome(value: string): string {
  if (value === '~') return os.homedir()
  if (value.startsWith('~/')) return path.join(os.homedir(), value.slice(2))
  return value
}

function podUrlToLocalPath(url: string, solidData: string): string {
  let parsed: URL

  try {
    parsed = new URL(url)
  } catch {
    throw new Error(`Invalid pod URL: ${url}`)
  }

  const segments = parsed.pathname
    .split('/')
    .filter(segment => segment.length > 0)
    .map(segment => {
      const decoded = decodeURIComponent(segment)
      if (
        decoded === '.' ||
        decoded === '..' ||
        decoded.includes('/') ||
        decoded.includes('\\')
      ) {
        throw new Error(`Invalid path segment in URL: ${segment}`)
      }
      return decoded
    })

  if (segments[0] === 'pod') {
    segments.shift()
  }

  return path.join(solidData, ...segments)
}

function optionValue(
  name: string,
  inlineValue: string | undefined,
  argv: string[],
  index: { value: number }
): string {
  if (inlineValue !== undefined) return inlineValue

  const next = argv[index.value + 1]
  if (next === undefined) {
    throw new Error(`Missing value for ${name}`)
  }

  index.value += 1
  return next
}

export function parseArgs(argv: string[]): ReindexArgs {
  const args: ReindexArgs = {
    wiki: '',
    podUrl: undefined,
    solidData: '~/solid-data',
    indexUrl: undefined,
    index: undefined,
    maxDepth: 1,
    check: false,
    write: false,
    json: false,
    includeStorageSuffix: true,
    followSymlinks: false,
    help: false,
  }

  const index = { value: 0 }

  while (index.value < argv.length) {
    const argument = argv[index.value]
    const equals = argument.indexOf('=')
    const name = equals >= 0 ? argument.slice(0, equals) : argument
    const inlineValue = equals >= 0 ? argument.slice(equals + 1) : undefined

    switch (name) {
      case '--wiki':
        args.wiki = optionValue(name, inlineValue, argv, index)
        break
      case '--pod-url':
        args.podUrl = optionValue(name, inlineValue, argv, index)
        break
      case '--solid-data':
        args.solidData = optionValue(name, inlineValue, argv, index)
        break
      case '--index-url':
        args.indexUrl = optionValue(name, inlineValue, argv, index)
        break
      case '--index':
        args.index = optionValue(name, inlineValue, argv, index)
        break
      case '--max-depth': {
        const value = optionValue(name, inlineValue, argv, index)
        const parsed = Number(value)
        if (!Number.isInteger(parsed) || parsed < 0) {
          throw new Error(`--max-depth must be a non-negative integer: ${value}`)
        }
        args.maxDepth = parsed
        break
      }
      case '--check':
        args.check = true
        break
      case '--write':
        args.write = true
        break
      case '--json':
        args.json = true
        break
      case '--include-storage-suffix':
        args.includeStorageSuffix = true
        break
      case '--no-include-storage-suffix':
        args.includeStorageSuffix = false
        break
      case '--follow-symlinks':
        args.followSymlinks = true
        break
      case '--help':
        args.help = true
        break
      default:
        throw new Error(`Unknown option: ${name}`)
    }

    index.value += 1
  }

  if (args.help) return args

  if (args.wiki === '') {
    throw new Error('--wiki is required')
  }

  if (args.check && args.write) {
    throw new Error('--check and --write are mutually exclusive')
  }

  if (!isPodUrl(args.wiki) && !args.podUrl) {
    throw new Error(
      '--pod-url is required when --wiki is a local path (for example: --pod-url https://pod.example.com/pod/notes/wiki/)'
    )
  }

  if (args.podUrl !== undefined && !isPodUrl(args.podUrl)) {
    throw new Error('--pod-url must be an http(s) URL')
  }

  if (!args.indexUrl) {
    const base = ensureTrailingSlash(
      isPodUrl(args.wiki) ? args.wiki : args.podUrl!
    )
    args.indexUrl = `${base}label-index.ttl`
  }

  return args
}

export function resolveWikiPaths(args: ReindexArgs): ResolvedWikiPaths {
  const solidData = path.resolve(expandHome(args.solidData))
  const wikiIsUrl = isPodUrl(args.wiki)

  if (!wikiIsUrl && !args.podUrl) {
    throw new Error('--pod-url is required when --wiki is a local path')
  }

  const wikiRootUrl = ensureTrailingSlash(
    wikiIsUrl ? args.wiki : args.podUrl!
  )
  const localDir = wikiIsUrl
    ? podUrlToLocalPath(args.wiki, solidData)
    : path.resolve(expandHome(args.wiki))
  const indexUrl = args.indexUrl ?? `${wikiRootUrl}label-index.ttl`
  const indexPath = args.index
    ? path.resolve(expandHome(args.index))
    : podUrlToLocalPath(indexUrl, solidData)

  return { wikiRootUrl, localDir, indexUrl, indexPath }
}

export function reindexWiki(args: ReindexArgs): ReindexResult {
  const resolved = resolveWikiPaths(args)

  if (
    !fs.existsSync(resolved.localDir) ||
    !fs.statSync(resolved.localDir).isDirectory()
  ) {
    throw new Error(`Wiki directory not found: ${resolved.localDir}`)
  }

  const relPaths = discoverLocalMarkdown(resolved.localDir, args.maxDepth, {
    includeStorageSuffix: args.includeStorageSuffix,
    followSymlinks: args.followSymlinks,
  })
  const expected = buildExpectedLabels(resolved.wikiRootUrl, relPaths)
  const existingTurtle = fs.existsSync(resolved.indexPath)
    ? fs.readFileSync(resolved.indexPath, 'utf8')
    : ''
  const { turtle, diff } = mergeLabelIndex(
    existingTurtle,
    resolved.indexUrl,
    resolved.wikiRootUrl,
    expected
  )
  const changed =
    diff.added.length > 0 ||
    diff.removed.length > 0 ||
    diff.updated.length > 0

  let wrote = false

  if (args.write && changed) {
    const directory = path.dirname(resolved.indexPath)
    fs.mkdirSync(directory, { recursive: true })

    const tempPath = path.join(
      directory,
      `.${path.basename(resolved.indexPath)}.${process.pid}.${Date.now()}.tmp`
    )

    try {
      fs.writeFileSync(tempPath, turtle, 'utf8')
      fs.renameSync(tempPath, resolved.indexPath)
    } catch (error) {
      try {
        fs.rmSync(tempPath, { force: true })
      } catch {
        // Ignore cleanup errors and report the original failure.
      }
      throw error
    }

    wrote = true
  }

  return {
    ...resolved,
    fileCount: relPaths.length,
    changed,
    wrote,
    added: diff.added,
    removed: diff.removed,
    updated: diff.updated,
  }
}

function printUsage(): void {
  console.log(`Usage: reindex-wiki --wiki <pod-url|local-path> [options]

Rebuild label-index.ttl from the local filesystem without network access.

Options:
  --wiki <pod-url|local-path>   Wiki root to index (required)
  --pod-url <url>               Subject base when --wiki is a local path
  --solid-data <path>           Solid data root (default: ~/solid-data)
  --index-url <url>             Index URL (default: <wiki>/label-index.ttl)
  --index <path>                Index file path (default: mapped from --index-url)
  --max-depth <n>               Container depth to scan (default: 1)
  --check                       Report drift without writing; exit 1 on drift
  --write                       Write the index if it changed
  --json                        Print a JSON result
  --include-storage-suffix      Map X.md$.txt to X.md (default)
  --no-include-storage-suffix   Ignore CSS storage-suffixed files
  --follow-symlinks             Follow symlinks (cycles guarded by realpath)
  --help                        Show this help`)
}

function printSummary(result: ReindexResult, args: ReindexArgs): void {
  console.log(`Wiki: ${result.wikiRootUrl}`)
  console.log(`Index: ${result.indexPath}`)
  console.log(`Index URL: ${result.indexUrl}`)
  console.log(`Files: ${result.fileCount}`)
  console.log(`Added: ${result.added.length}`)
  for (const subject of result.added) console.log(`  + ${subject}`)
  console.log(`Removed: ${result.removed.length}`)
  for (const subject of result.removed) console.log(`  - ${subject}`)
  console.log(`Updated: ${result.updated.length}`)
  for (const update of result.updated) {
    console.log(`  ~ ${update.subject}: ${update.from} -> ${update.to}`)
  }

  if (args.write) {
    console.log(result.wrote ? 'Wrote index.' : 'Index is already up to date.')
  } else if (args.check) {
    console.log(result.changed ? 'Drift detected.' : 'Index is up to date.')
  } else {
    console.log('Dry run: no files written.')
  }
}

export function main(argv: string[] = process.argv.slice(2)): number {
  let args: ReindexArgs

  try {
    args = parseArgs(argv)
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    return 2
  }

  if (args.help) {
    printUsage()
    return 0
  }

  try {
    const result = reindexWiki(args)

    if (args.json) {
      console.log(
        JSON.stringify(
          {
            wiki: result.wikiRootUrl,
            localDir: result.localDir,
            indexUrl: result.indexUrl,
            indexPath: result.indexPath,
            fileCount: result.fileCount,
            changed: result.changed,
            wrote: result.wrote,
            mode: args.write ? 'write' : args.check ? 'check' : 'dry-run',
            added: result.added,
            removed: result.removed,
            updated: result.updated,
          },
          null,
          2
        )
      )
    } else {
      printSummary(result, args)
    }

    return args.check && result.changed ? 1 : 0
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    return 2
  }
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  process.exitCode = main()
}
