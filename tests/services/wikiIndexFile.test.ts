import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Parser } from 'n3'
import {
  discoverLocalMarkdown,
  toPodUrl,
  buildExpectedLabels,
  mergeLabelIndex,
} from '../../src/services/wikiIndexFile.js'

const RDFS_LABEL = 'http://www.w3.org/2000/01/rdf-schema#label'
const RDFS_COMMENT = 'http://www.w3.org/2000/01/rdf-schema#comment'
const INDEX_URL = 'https://pod.example.com/pod/notes/wiki/label-index.ttl'
const WIKI_ROOT = 'https://pod.example.com/pod/notes/wiki/'

const tempDirs: string[] = []

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wiki-index-file-'))
  tempDirs.push(dir)
  return dir
}

function writeFile(root: string, relPath: string, content = ''): void {
  const filePath = path.join(root, relPath)
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, content)
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

describe('wikiIndexFile', () => {
  describe('discoverLocalMarkdown', () => {
    it('includes files in containers up to maxDepth', () => {
      const root = makeTempDir()
      writeFile(root, 'a.md')
      writeFile(root, 'sub/b.md')
      writeFile(root, 'sub/deep/c.md')

      expect(discoverLocalMarkdown(root, 0)).toEqual(['a.md'])
      expect(discoverLocalMarkdown(root, 1)).toEqual(['a.md', 'sub/b.md'])
      expect(discoverLocalMarkdown(root, 2)).toEqual([
        'a.md',
        'sub/b.md',
        'sub/deep/c.md',
      ])
    })

    it('skips dot segments, node_modules and non-markdown files', () => {
      const root = makeTempDir()
      writeFile(root, 'a.md')
      writeFile(root, '.git/d.md')
      writeFile(root, 'node_modules/e.md')
      writeFile(root, 'sub/.hidden/f.md')
      writeFile(root, 'sub/g.md')
      writeFile(root, 'notes.txt')

      expect(discoverLocalMarkdown(root, 3)).toEqual(['a.md', 'sub/g.md'])
    })

    it('maps the CSS storage suffix to the markdown path', () => {
      const root = makeTempDir()
      writeFile(root, 'suffix.md$.txt')

      expect(discoverLocalMarkdown(root, 0)).toEqual(['suffix.md'])
      expect(
        discoverLocalMarkdown(root, 0, { includeStorageSuffix: false })
      ).toEqual([])
    })

    it('dedupes a storage suffix and a real markdown file', () => {
      const root = makeTempDir()
      writeFile(root, 'suffix.md$.txt')
      writeFile(root, 'suffix.md')

      expect(discoverLocalMarkdown(root, 0)).toEqual(['suffix.md'])
    })

    it('does not follow symlinks by default', () => {
      const root = makeTempDir()
      writeFile(root, 'real/page.md')
      fs.symlinkSync(path.join(root, 'real'), path.join(root, 'link'), 'dir')

      expect(discoverLocalMarkdown(root, 1)).toEqual(['real/page.md'])
    })

    it('follows symlinks when requested', () => {
      const root = makeTempDir()
      writeFile(root, 'real/page.md')
      fs.symlinkSync(path.join(root, 'real'), path.join(root, 'link'), 'dir')

      expect(
        discoverLocalMarkdown(root, 1, { followSymlinks: true })
      ).toEqual(['link/page.md', 'real/page.md'])
    })

    it('guards against symlink cycles by realpath', () => {
      const root = makeTempDir()
      writeFile(root, 'real/page.md')
      fs.symlinkSync(root, path.join(root, 'real', 'loop'), 'dir')

      expect(
        discoverLocalMarkdown(root, 4, { followSymlinks: true })
      ).toEqual(['real/page.md'])
    })
  })

  describe('toPodUrl', () => {
    it('encodes each path segment and ensures a trailing root slash', () => {
      expect(
        toPodUrl('https://pod.example.com/pod/notes/wiki', 'sub/my page.md')
      ).toBe('https://pod.example.com/pod/notes/wiki/sub/my%20page.md')
    })
  })

  describe('buildExpectedLabels', () => {
    it('maps absolute URLs to title-cased basenames', () => {
      const expected = buildExpectedLabels(WIKI_ROOT, [
        'page.md',
        'sub/my page.md',
      ])

      expect([...expected]).toEqual([
        ['https://pod.example.com/pod/notes/wiki/page.md', 'Page'],
        ['https://pod.example.com/pod/notes/wiki/sub/my%20page.md', 'My Page'],
      ])
    })
  })

  describe('mergeLabelIndex', () => {
    const existingTurtle = `@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .

<stale.md> rdfs:label "Stale" .
<page.md> rdfs:label "Old Page" .
<keep.md> rdfs:label "Keep" .
<keep.md> rdfs:comment "A comment" .
<https://pod.example.com/other/page.md> rdfs:label "Other" .
`

    const expected = new Map<string, string>([
      ['https://pod.example.com/pod/notes/wiki/page.md', 'Page'],
      ['https://pod.example.com/pod/notes/wiki/new.md', 'New'],
      ['https://pod.example.com/pod/notes/wiki/keep.md', 'Keep'],
    ])

    it('resolves relative subjects, removes stale, updates and adds labels', () => {
      const { turtle, diff } = mergeLabelIndex(
        existingTurtle,
        INDEX_URL,
        WIKI_ROOT,
        expected
      )

      expect(diff.added).toEqual([
        'https://pod.example.com/pod/notes/wiki/new.md',
      ])
      expect(diff.removed).toEqual([
        'https://pod.example.com/pod/notes/wiki/stale.md',
      ])
      expect(diff.updated).toEqual([
        {
          subject: 'https://pod.example.com/pod/notes/wiki/page.md',
          from: 'Old Page',
          to: 'Page',
        },
      ])

      const parser = new Parser()
      const quads = parser.parse(turtle)
      const labels = quads
        .filter(quad => quad.predicate.value === RDFS_LABEL)
        .map(quad => [quad.subject.value, quad.object.value])

      expect(labels).toEqual([
        ['https://pod.example.com/other/page.md', 'Other'],
        ['https://pod.example.com/pod/notes/wiki/keep.md', 'Keep'],
        ['https://pod.example.com/pod/notes/wiki/new.md', 'New'],
        ['https://pod.example.com/pod/notes/wiki/page.md', 'Page'],
      ])
    })

    it('preserves comments and labels outside the wiki root', () => {
      const { turtle } = mergeLabelIndex(
        existingTurtle,
        INDEX_URL,
        WIKI_ROOT,
        expected
      )
      const quads = new Parser().parse(turtle)

      expect(
        quads.some(
          quad =>
            quad.subject.value ===
              'https://pod.example.com/pod/notes/wiki/keep.md' &&
            quad.predicate.value === RDFS_COMMENT &&
            quad.object.value === 'A comment'
        )
      ).toBe(true)
      expect(
        quads.some(
          quad =>
            quad.subject.value ===
              'https://pod.example.com/other/page.md' &&
            quad.predicate.value === RDFS_LABEL &&
            quad.object.value === 'Other'
        )
      ).toBe(true)
      expect(
        quads.some(quad =>
          quad.subject.value.includes('/stale.md')
        )
      ).toBe(false)
    })

    it('is idempotent on a second merge', () => {
      const first = mergeLabelIndex(existingTurtle, INDEX_URL, WIKI_ROOT, expected)
      const second = mergeLabelIndex(
        first.turtle,
        INDEX_URL,
        WIKI_ROOT,
        expected
      )

      expect(second.diff).toEqual({ added: [], removed: [], updated: [] })
      expect(second.turtle).toBe(first.turtle)
    })

    it('produces deterministic output', () => {
      const first = mergeLabelIndex(existingTurtle, INDEX_URL, WIKI_ROOT, expected)
      const second = mergeLabelIndex(existingTurtle, INDEX_URL, WIKI_ROOT, expected)

      expect(second.turtle).toBe(first.turtle)
    })

    it('treats empty existing turtle as an empty graph', () => {
      const { turtle, diff } = mergeLabelIndex('', INDEX_URL, WIKI_ROOT, expected)

      expect(diff.added).toEqual([...expected.keys()].sort())
      expect(diff.removed).toEqual([])
      expect(diff.updated).toEqual([])
      expect(new Parser().parse(turtle)).toHaveLength(expected.size)
    })
  })
})
