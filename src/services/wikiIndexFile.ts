import fs from 'node:fs'
import path from 'node:path'
import { DataFactory, Parser, Writer } from 'n3'
import type { Quad } from 'n3'
import { basenameToTitle } from './wikiLabels.js'

const RDFS_NAMESPACE = 'http://www.w3.org/2000/01/rdf-schema#'
const RDFS_LABEL = `${RDFS_NAMESPACE}label`
const STORAGE_SUFFIX = '$.txt'

const { literal, namedNode, quad } = DataFactory

export interface DiscoverLocalMarkdownOptions {
  includeStorageSuffix?: boolean
  followSymlinks?: boolean
}

export interface LabelIndexDiff {
  added: string[]
  removed: string[]
  updated: Array<{ subject: string; from: string; to: string }>
}

export interface MergeLabelIndexResult {
  turtle: string
  diff: LabelIndexDiff
}

function isSkippedName(name: string): boolean {
  return name === 'node_modules' || name.startsWith('.')
}

function compareValues(a: string, b: string): number {
  if (a < b) return -1
  if (a > b) return 1
  return 0
}

function compareQuads(a: Quad, b: Quad): number {
  return (
    compareValues(a.subject.value, b.subject.value) ||
    compareValues(a.predicate.value, b.predicate.value) ||
    compareValues(a.object.value, b.object.value)
  )
}

export function discoverLocalMarkdown(
  rootDir: string,
  maxDepth: number,
  options: DiscoverLocalMarkdownOptions = {}
): string[] {
  const includeStorageSuffix = options.includeStorageSuffix ?? true
  const followSymlinks = options.followSymlinks ?? false
  const found = new Map<string, boolean>()

  const addFile = (relPath: string, name: string): void => {
    let target: string | null = null
    let isRealMarkdown = false

    if (name.endsWith('.md')) {
      target = relPath
      isRealMarkdown = true
    } else if (includeStorageSuffix && name.endsWith(`.md${STORAGE_SUFFIX}`)) {
      target = relPath.slice(0, -STORAGE_SUFFIX.length)
    }

    if (target === null) return

    const existing = found.get(target)
    if (existing === undefined || (isRealMarkdown && !existing)) {
      found.set(target, isRealMarkdown)
    }
  }

  const visit = (
    absDir: string,
    relDir: string,
    depth: number,
    ancestors: Set<string>
  ): void => {
    if (depth > maxDepth) return

    let realDir: string
    try {
      realDir = fs.realpathSync(absDir)
    } catch {
      return
    }

    if (ancestors.has(realDir)) return

    const nextAncestors = new Set(ancestors)
    nextAncestors.add(realDir)

    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(absDir, { withFileTypes: true })
    } catch {
      return
    }

    for (const entry of entries) {
      const name = entry.name
      if (isSkippedName(name)) continue

      const absPath = path.join(absDir, name)
      const relPath = relDir === '' ? name : `${relDir}/${name}`

      let isFile = entry.isFile()
      let isDirectory = entry.isDirectory()

      if (entry.isSymbolicLink()) {
        if (!followSymlinks) continue

        try {
          const stat = fs.statSync(absPath)
          isFile = stat.isFile()
          isDirectory = stat.isDirectory()
        } catch {
          continue
        }
      }

      if (isFile) {
        addFile(relPath, name)
      } else if (isDirectory) {
        visit(absPath, relPath, depth + 1, nextAncestors)
      }
    }
  }

  visit(rootDir, '', 0, new Set())

  return [...found.keys()].sort(compareValues)
}

export function toPodUrl(wikiRootUrl: string, relPath: string): string {
  const root = wikiRootUrl.endsWith('/') ? wikiRootUrl : `${wikiRootUrl}/`
  const segments = relPath.split('/').filter(segment => segment.length > 0)
  return `${root}${segments.map(encodeURIComponent).join('/')}`
}

export function buildExpectedLabels(
  wikiRootUrl: string,
  relPaths: string[]
): Map<string, string> {
  const expected = new Map<string, string>()

  for (const relPath of relPaths) {
    const segments = relPath.split('/')
    const basename = segments[segments.length - 1] ?? ''
    expected.set(toPodUrl(wikiRootUrl, relPath), basenameToTitle(basename))
  }

  return expected
}

export function mergeLabelIndex(
  existingTurtle: string,
  indexUrl: string,
  wikiRootUrl: string,
  expected: Map<string, string>
): MergeLabelIndexResult {
  const parser = new Parser({ baseIRI: indexUrl })
  const existingQuads =
    existingTurtle.trim() === '' ? [] : parser.parse(existingTurtle)

  const existingLabels = new Map<string, string>()

  for (const existing of existingQuads) {
    if (
      existing.predicate.value === RDFS_LABEL &&
      existing.subject.value.startsWith(wikiRootUrl)
    ) {
      existingLabels.set(existing.subject.value, existing.object.value)
    }
  }

  const added = [...expected.keys()]
    .filter(subject => !existingLabels.has(subject))
    .sort(compareValues)
  const removed = [...existingLabels.keys()]
    .filter(subject => !expected.has(subject))
    .sort(compareValues)
  const updated = [...expected.entries()]
    .filter(
      ([subject, label]) =>
        existingLabels.has(subject) && existingLabels.get(subject) !== label
    )
    .map(([subject, to]) => ({
      subject,
      from: existingLabels.get(subject)!,
      to,
    }))
    .sort((a, b) => compareValues(a.subject, b.subject))

  const preserved = existingQuads.filter(
    existing =>
      !(
        existing.predicate.value === RDFS_LABEL &&
        existing.subject.value.startsWith(wikiRootUrl)
      )
  )

  const labelQuads = [...expected.entries()].map(([subject, label]) =>
    quad(namedNode(subject), namedNode(RDFS_LABEL), literal(label))
  )

  const quads = [...preserved, ...labelQuads].sort(compareQuads)
  const writer = new Writer({
    format: 'text/turtle',
    prefixes: { rdfs: RDFS_NAMESPACE },
  })
  const body = writer.quadsToString(quads)
  const turtle =
    body === '' ? '' : `@prefix rdfs: <${RDFS_NAMESPACE}> .\n${body}`

  return {
    turtle,
    diff: { added, removed, updated },
  }
}
