import { describe, it, expect } from 'vitest'
import { buildInsertDeletePatch, INSERT_DELETE_PATCH_PREFIX } from '../../src/services/buildPatch.js'

describe('buildPatch', () => {
  describe('buildInsertDeletePatch', () => {
    it('should build a valid InsertDeletePatch with item', () => {
      const itemTurtle = '<https://example.com/activities/1> a as:Create .'
      const itemId = 'https://example.com/activities/1'
      const pageUrl = 'https://example.com/inbox/pages/1234567890'
      const result = buildInsertDeletePatch(itemTurtle, itemId, pageUrl)
      expect(result).toContain('solid:InsertDeletePatch')
      expect(result).toContain(itemId)
      expect(result).toContain('as:items')
    })

    it('should include the correct prefixes', () => {
      const result = buildInsertDeletePatch('', 'https://example.com/item/1', 'https://example.com/page')
      expect(result).toContain('@prefix as:')
      expect(result).toContain('@prefix rdf:')
      expect(result).toContain('@prefix solid:')
    })

    it('should include item URL in the patch', () => {
      const itemId = 'https://example.com/activities/123'
      const result = buildInsertDeletePatch('<item> <prop> "value" .', itemId, 'https://example.com/page')
      expect(result).toContain(itemId)
    })

    it('should create well-formed patch body without requiring pageUrl', () => {
      const itemId = 'https://example.com/activities/123'
      const result = buildInsertDeletePatch('<item> <prop> "value" .', itemId, 'https://example.com/page')
      expect(result).toContain('solid:inserts')
      expect(result).toContain('as:items')
      expect(result).toMatch(/_\:patch a solid:InsertDeletePatch/)
    })

    it('should embed item turtle in the patch', () => {
      const itemTurtle = '<https://example.com/activities/1> a as:Create; as:actor <https://example.com/actor/#me> .'
      const result = buildInsertDeletePatch(itemTurtle, 'https://example.com/activities/1', 'https://example.com/page')
      expect(result).toContain(itemTurtle)
    })
  })

  describe('INSERT_DELETE_PATCH_PREFIX', () => {
    it('should contain required prefixes', () => {
      expect(INSERT_DELETE_PATCH_PREFIX).toContain('as:')
      expect(INSERT_DELETE_PATCH_PREFIX).toContain('rdf:')
      expect(INSERT_DELETE_PATCH_PREFIX).toContain('solid:')
    })
  })
})