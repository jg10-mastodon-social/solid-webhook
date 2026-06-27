import { describe, it, expect, vi, beforeEach } from 'vitest'
import jsonld from 'jsonld'
import { persistInboxItem } from '../../src/services/persistInbox.js'
import { skolemizeBlankNodes } from '../../src/services/activityToRdf.js'
import { buildUpdatePatch } from '../../src/services/buildPatch.js'

const mockFetch = vi.fn()

function verifyGenidConsistency(body: string, skolemizeBase: string): boolean {
  const basePattern = skolemizeBase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

  const typePattern = new RegExp(`<(${basePattern}\\d+_\\d+)>\\s+[^\\s]+#[^>]*type>[^<]*<[^>]*Image`, 'i')
  const typeMatch = body.match(typePattern)

  if (!typeMatch) return false

  const genid = typeMatch[1]
  const genidPattern = genid.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

  const hasMediaType = new RegExp(`<${genidPattern}>[^\\n]*#mediaType`, 'i').test(body)
  const hasUrl = new RegExp(`<${genidPattern}>[^\\n]*#url`, 'i').test(body)

  return hasMediaType && hasUrl
}

describe('persistInboxItem integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFetch.mockResolvedValue(
      new Response(null, { status: 200 })
    )
  })

  it('should preserve attachment objects with nested properties through JSON-LD conversion', async () => {
    const activity = {
      type: 'Create',
      id: 'https://example.com/activities/123',
      actor: 'https://example.com/actor/#me',
      object: {
        type: 'Note',
        content: 'Test with image',
        attachment: [
          {
            type: 'Image',
            url: 'https://example.com/image.png',
            mediaType: 'image/png',
          },
        ],
      },
    }
    const pageUrl = 'https://example.com/inbox/pages/1234567890'
    const skolemizeBase = 'https://example.com/.well-known/genid/'

    await persistInboxItem(activity, pageUrl, mockFetch, { skolemizeBase })

    expect(mockFetch).toHaveBeenCalled()
    const patchCall = mockFetch.mock.calls.find(
      call => call[1]?.method === 'PATCH'
    )
    expect(patchCall).toBeDefined()

    const patchBody = patchCall?.[1]?.body as string

    expect(patchBody).toContain('https://www.w3.org/ns/activitystreams#Image')
    expect(patchBody).toContain('https://www.w3.org/ns/activitystreams#url')
    expect(patchBody).toContain('https://example.com/image.png')
    expect(patchBody).toContain('https://www.w3.org/ns/activitystreams#mediaType')
    expect(patchBody).toContain('"image/png"')

    expect(verifyGenidConsistency(patchBody, skolemizeBase)).toBe(true)
  })

  it('should preserve multiple attachments with nested properties', async () => {
    const activity = {
      type: 'Create',
      id: 'https://example.com/activities/456',
      object: {
        type: 'Note',
        content: 'Test with multiple images',
        attachment: [
          {
            type: 'Image',
            url: 'https://example.com/image1.png',
            mediaType: 'image/png',
          },
          {
            type: 'Image',
            url: 'https://example.com/image2.jpg',
            mediaType: 'image/jpeg',
          },
        ],
      },
    }
    const pageUrl = 'https://example.com/inbox/pages/1234567890'
    const skolemizeBase = 'https://example.com/.well-known/genid/'

    await persistInboxItem(activity, pageUrl, mockFetch, { skolemizeBase })

    const patchCall = mockFetch.mock.calls.find(
      call => call[1]?.method === 'PATCH'
    )
    const patchBody = patchCall?.[1]?.body as string

    expect(patchBody).toContain('https://www.w3.org/ns/activitystreams#Image')
    expect(patchBody).toContain('https://example.com/image1.png')
    expect(patchBody).toContain('https://example.com/image2.jpg')
    expect(patchBody).toContain('"image/png"')
    expect(patchBody).toContain('"image/jpeg"')

    expect(verifyGenidConsistency(patchBody, skolemizeBase)).toBe(true)
  })

  it('should preserve tag objects with nested properties', async () => {
    const activity = {
      type: 'Create',
      id: 'https://example.com/activities/789',
      object: {
        type: 'Note',
        content: 'Test with tag',
        tag: [
          {
            type: 'Mention',
            href: 'https://example.com/user/1',
            name: '@user@example.com',
          },
        ],
      },
    }
    const pageUrl = 'https://example.com/inbox/pages/1234567890'
    const skolemizeBase = 'https://example.com/.well-known/genid/'

    await persistInboxItem(activity, pageUrl, mockFetch, { skolemizeBase })

    const patchCall = mockFetch.mock.calls.find(
      call => call[1]?.method === 'PATCH'
    )
    const patchBody = patchCall?.[1]?.body as string

    expect(patchBody).toContain('https://www.w3.org/ns/activitystreams#Mention')
    expect(patchBody).toContain('https://www.w3.org/ns/activitystreams#href')
    expect(patchBody).toContain('https://example.com/user/1')
    expect(patchBody).toContain('https://www.w3.org/ns/activitystreams#name')
    expect(patchBody).toContain('@user@example.com')
  })

  it('should preserve attachment definitions when updating an object', async () => {
    const noteId = 'https://example.com/notes/123'
    const pageUrl = 'https://example.com/inbox/pages/1234567890'
    const skolemizeBase = 'https://example.com/.well-known/genid/'

    const oldNoteWithAttachment = {
      type: 'Note',
      id: noteId,
      content: 'Original post with image',
      attachment: [
        {
          type: 'Image',
          url: 'https://example.com/old-image.png',
          mediaType: 'image/png',
        },
      ],
    }

    const oldActivityWithContext = {
      ...oldNoteWithAttachment,
      '@context': [
        'https://www.w3.org/ns/activitystreams',
        'https://w3id.org/security/v1',
      ],
    }
    const oldExpanded = await jsonld.expand(oldActivityWithContext)
    const oldNquads = await jsonld.toRDF(oldExpanded, { format: 'application/n-quads' }) as string
    const oldTurtle = skolemizeBlankNodes(oldNquads, skolemizeBase)

    const pageContent = `
@prefix as: <https://www.w3.org/ns/activitystreams#>.
@prefix genid: <${skolemizeBase}>.

<${pageUrl}> as:items <${noteId}>.
${noteId} a as:Note.
${oldTurtle}
`

    mockFetch.mockResolvedValueOnce(
      new Response(pageContent, {
        status: 200,
        headers: { 'content-type': 'text/turtle' },
      })
    )

    const newNoteWithAttachment = {
      type: 'Note',
      id: noteId,
      content: 'Updated post with new image',
      attachment: [
        {
          type: 'Image',
          url: 'https://example.com/new-image.png',
          mediaType: 'image/png',
        },
      ],
    }

    const newActivityWithContext = {
      ...newNoteWithAttachment,
      '@context': [
        'https://www.w3.org/ns/activitystreams',
        'https://w3id.org/security/v1',
      ],
    }
    const newExpanded = await jsonld.expand(newActivityWithContext)
    const newNquads = await jsonld.toRDF(newExpanded, { format: 'application/n-quads' }) as string
    const newTurtle = skolemizeBlankNodes(newNquads, skolemizeBase)

    const patchBody = buildUpdatePatch(oldTurtle, newTurtle, noteId, pageUrl)

    expect(patchBody).toContain('https://www.w3.org/ns/activitystreams#Image')
    expect(patchBody).toContain('https://example.com/new-image.png')
    expect(patchBody).toContain('"image/png"')

    const deleteMatch = patchBody.match(/solid:deletes \{[^}]+\}/s)
    const insertMatch = patchBody.match(/solid:inserts \{[^}]+\}/s)
    expect(deleteMatch).toBeTruthy()
    expect(insertMatch).toBeTruthy()

    expect(verifyGenidConsistency(patchBody, skolemizeBase)).toBe(true)
  })
})
