import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  parseArgs,
  resolveWikiPaths,
  reindexWiki,
} from '../../src/scripts/reindexWiki.js'

const POD_WIKI = 'https://pod.example.com/pod/notes/wiki/'

const tempDirs: string[] = []

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reindex-wiki-'))
  tempDirs.push(dir)
  return dir
}

function makeWiki(): { solidData: string; wikiDir: string } {
  const solidData = makeTempDir()
  const wikiDir = path.join(solidData, 'notes', 'wiki')
  fs.mkdirSync(path.join(wikiDir, 'sub'), { recursive: true })
  fs.writeFileSync(path.join(wikiDir, 'page.md'), '')
  fs.writeFileSync(path.join(wikiDir, 'sub', 'child.md'), '')
  return { solidData, wikiDir }
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

describe('reindexWiki CLI', () => {
  describe('parseArgs', () => {
    it('applies defaults for a pod URL wiki', () => {
      const args = parseArgs(['--wiki', POD_WIKI])

      expect(args).toEqual({
        wiki: POD_WIKI,
        podUrl: undefined,
        solidData: '~/solid-data',
        indexUrl: `${POD_WIKI}label-index.ttl`,
        index: undefined,
        maxDepth: 1,
        check: false,
        write: false,
        json: false,
        includeStorageSuffix: true,
        followSymlinks: false,
        help: false,
      })
    })

    it('rejects --check together with --write', () => {
      expect(() =>
        parseArgs(['--wiki', POD_WIKI, '--check', '--write'])
      ).toThrow(/mutually exclusive/i)
    })

    it('requires --pod-url when --wiki is a local path', () => {
      expect(() =>
        parseArgs(['--wiki', '/tmp/some-wiki'])
      ).toThrow(/pod-url/i)
    })
  })

  describe('resolveWikiPaths', () => {
    it('strips a leading /pod from the local path but keeps it in subjects', () => {
      const { solidData, wikiDir } = makeWiki()
      const args = parseArgs([
        '--wiki',
        POD_WIKI,
        '--solid-data',
        solidData,
      ])

      const resolved = resolveWikiPaths(args)

      expect(resolved.wikiRootUrl).toBe(POD_WIKI)
      expect(resolved.localDir).toBe(wikiDir)
      expect(resolved.indexUrl).toBe(`${POD_WIKI}label-index.ttl`)
      expect(resolved.indexPath).toBe(
        path.join(wikiDir, 'label-index.ttl')
      )
    })

    it('maps a local wiki to its pod subject base and local index path', () => {
      const { solidData, wikiDir } = makeWiki()
      const args = parseArgs([
        '--wiki',
        wikiDir,
        '--pod-url',
        POD_WIKI,
        '--solid-data',
        solidData,
      ])

      const resolved = resolveWikiPaths(args)

      expect(resolved.wikiRootUrl).toBe(POD_WIKI)
      expect(resolved.localDir).toBe(wikiDir)
      expect(resolved.indexUrl).toBe(`${POD_WIKI}label-index.ttl`)
      expect(resolved.indexPath).toBe(
        path.join(wikiDir, 'label-index.ttl')
      )
    })
  })

  describe('reindexWiki', () => {
    it('reports drift in check mode and does not write', () => {
      const { solidData, wikiDir } = makeWiki()
      const args = parseArgs([
        '--wiki',
        wikiDir,
        '--pod-url',
        POD_WIKI,
        '--solid-data',
        solidData,
        '--check',
      ])

      const result = reindexWiki(args)

      expect(result.fileCount).toBe(2)
      expect(result.changed).toBe(true)
      expect(result.wrote).toBe(false)
      expect(result.added).toEqual([
        `${POD_WIKI}page.md`,
        `${POD_WIKI}sub/child.md`,
      ])
      expect(result.removed).toEqual([])
      expect(result.updated).toEqual([])
      expect(fs.existsSync(result.indexPath)).toBe(false)
    })

    it('writes in write mode and reports an empty diff on the second run', () => {
      const { solidData, wikiDir } = makeWiki()
      const baseArgs = [
        '--wiki',
        wikiDir,
        '--pod-url',
        POD_WIKI,
        '--solid-data',
        solidData,
      ]

      const first = reindexWiki(parseArgs([...baseArgs, '--write']))

      expect(first.changed).toBe(true)
      expect(first.wrote).toBe(true)
      expect(fs.existsSync(first.indexPath)).toBe(true)

      const second = reindexWiki(parseArgs([...baseArgs, '--write']))

      expect(second.changed).toBe(false)
      expect(second.wrote).toBe(false)
      expect(second.added).toEqual([])
      expect(second.removed).toEqual([])
      expect(second.updated).toEqual([])
    })

    it('treats a missing index as an empty graph', () => {
      const { solidData, wikiDir } = makeWiki()
      const args = parseArgs([
        '--wiki',
        wikiDir,
        '--pod-url',
        POD_WIKI,
        '--solid-data',
        solidData,
      ])

      const result = reindexWiki(args)

      expect(result.added).toEqual([
        `${POD_WIKI}page.md`,
        `${POD_WIKI}sub/child.md`,
      ])
      expect(result.removed).toEqual([])
      expect(result.updated).toEqual([])
      expect(result.wrote).toBe(false)
    })

    it('does not modify the index in check mode when it has drifted', () => {
      const { solidData, wikiDir } = makeWiki()
      const baseArgs = [
        '--wiki',
        wikiDir,
        '--pod-url',
        POD_WIKI,
        '--solid-data',
        solidData,
      ]

      const written = reindexWiki(parseArgs([...baseArgs, '--write']))
      const before = fs.readFileSync(written.indexPath, 'utf8')

      fs.rmSync(path.join(wikiDir, 'sub', 'child.md'))
      fs.writeFileSync(path.join(wikiDir, 'new.md'), '')

      const checked = reindexWiki(parseArgs([...baseArgs, '--check']))

      expect(checked.changed).toBe(true)
      expect(checked.wrote).toBe(false)
      expect(checked.added).toEqual([`${POD_WIKI}new.md`])
      expect(checked.removed).toEqual([`${POD_WIKI}sub/child.md`])
      expect(fs.readFileSync(written.indexPath, 'utf8')).toBe(before)
    })
  })
})
