import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  injectContexts,
  skolemizeBlankNodes,
  activityToTurtle,
} from '../../src/services/activityToRdf.js'

describe('activityToRdf', () => {
  describe('injectContexts', () => {
    it('should inject ActivityStreams and Security contexts', () => {
      const activity = {
        type: 'Create',
        id: 'https://example.com/activities/1',
        actor: 'https://example.com/actor/#me',
      }
      const result = injectContexts(activity)
      expect(result['@context']).toBeDefined()
      const contexts = result['@context'] as unknown[]
      expect(contexts).toContainEqual(expect.objectContaining({ as: 'https://www.w3.org/ns/activitystreams#' }))
      expect(contexts).toContainEqual(expect.objectContaining({ sec: 'https://w3id.org/security#' }))
    })

    it('should preserve existing @context if present', () => {
      const activity = {
        '@context': 'https://example.com/custom-context',
        type: 'Create',
      }
      const result = injectContexts(activity as Record<string, unknown>)
      const contexts = result['@context'] as unknown[]
      expect(contexts).toContain('https://example.com/custom-context')
    })

    it('should handle @context as array', () => {
      const activity = {
        '@context': ['https://example.com/context1', 'https://example.com/context2'],
        type: 'Create',
      }
      const result = injectContexts(activity as Record<string, unknown>)
      const contexts = result['@context'] as unknown[]
      expect(contexts).toContain('https://example.com/context1')
      expect(contexts).toContain('https://example.com/context2')
    })
  })

  describe('skolemizeBlankNodes', () => {
    it('should replace blank nodes with skolemized URIs', () => {
      const turtle = '_:b0 <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> <https://www.w3.org/ns/activitystreams#Create> .'
      const result = skolemizeBlankNodes(turtle, 'https://example.com/.well-known/genid/')
      expect(result).toMatch(/https:\/\/example\.com\/\.well-known\/genid\/\d+_0/)
      expect(result).not.toContain('_:b0')
    })

    it('should handle multiple blank nodes', () => {
      const turtle = '_:b0 <http://purl.org/dc/terms/creator> _:b1 . _:b1 <http://xmlns.com/foaf/0.1/name> "Test" .'
      const result = skolemizeBlankNodes(turtle, 'https://example.com/.well-known/genid/')
      expect(result).toMatch(/genid\/\d+_0/)
      expect(result).toMatch(/genid\/\d+_1/)
    })

    it('should not modify content without blank nodes', () => {
      const turtle = '<https://example.com/activities/1> <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> <https://www.w3.org/ns/activitystreams#Create> .'
      const result = skolemizeBlankNodes(turtle, 'https://example.com/.well-known/genid/')
      expect(result).toBe(turtle)
    })
  })

  describe('activityToTurtle', () => {
    it('should convert a basic activity to JSON-LD with contexts', () => {
      const activity = {
        type: 'Create',
        id: 'https://example.com/activities/1',
        actor: 'https://example.com/actor/#me',
        object: {
          type: 'Note',
          content: 'Hello world',
        },
      }
      const result = activityToTurtle(activity)
      const parsed = JSON.parse(result)
      expect(parsed['@context']).toBeDefined()
      expect(parsed.type).toBe('Create')
      expect(parsed.id).toBe('https://example.com/activities/1')
    })

    it('should preserve nested objects', () => {
      const activity = {
        type: 'Create',
        id: 'https://example.com/activities/1',
        object: {
          type: 'Note',
          content: 'Test',
          tag: [
            { type: 'Mention', href: 'https://example.com/user/1' },
          ],
        },
      }
      const result = activityToTurtle(activity)
      const parsed = JSON.parse(result)
      expect(parsed.object.content).toBe('Test')
      expect(parsed.object.tag).toHaveLength(1)
    })
  })
})