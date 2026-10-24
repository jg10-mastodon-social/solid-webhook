import { basenameToTitle, filenameToTitle } from '../../src/services/wikiLabels.js'

describe('wikiLabels', () => {
  describe('basenameToTitle', () => {
    it('converts a lowercase index filename to Index', () => {
      expect(basenameToTitle('index.md')).toBe('Index')
    })

    it('decodes percent-encoded spaces and title-cases', () => {
      expect(basenameToTitle('marine%20cloud%20brightening.md')).toBe(
        'Marine Cloud Brightening'
      )
    })

    it('lowercases the remainder of all-caps names', () => {
      expect(basenameToTitle('MDB.md')).toBe('Mdb')
    })

    it('splits on spaces', () => {
      expect(basenameToTitle('create missing page.md')).toBe('Create Missing Page')
    })

    it('splits on hyphens and lowercases the remainder', () => {
      expect(basenameToTitle('PodOS-wiki.md')).toBe('Podos Wiki')
    })
  })

  describe('filenameToTitle', () => {
    it('derives the title from the final URL segment', () => {
      expect(
        filenameToTitle('https://pod.example.com/notes/wiki/foo%20bar.md')
      ).toBe('Foo Bar')
    })
  })
})
