import { registerActorTransformer } from '../actorTransformers.js'
import type { ActorTransformer } from '../actorTransformers.js'

const ACTOR = 'https://rss-parrot.net/u/savagechickens.com'

const transformSavageChickens: ActorTransformer = async (activity, fetch) => {
  const object = activity.object as Record<string, unknown> | undefined
  if (!object || typeof object.content !== 'string') {
    return activity
  }

  const content = object.content as string
  const urlMatch = content.match(/https?:\/\/[^\s<>"]+\.html/)
  if (!urlMatch) {
    return activity
  }

  const oembedUrl = `https://www.savagechickens.com/wp-json/oembed/1.0/embed?url=${urlMatch[0]}`
  let oembedResponse: Response
  try {
    oembedResponse = await fetch(oembedUrl)
  } catch {
    return activity
  }
  if (!oembedResponse.ok) {
    return activity
  }

  const oembed = await oembedResponse.json() as { thumbnail_url?: string }
  if (oembed.thumbnail_url) {
    object.attachment = [{ url: oembed.thumbnail_url, type: 'Image' }]
  }

  return activity
}

registerActorTransformer(ACTOR, transformSavageChickens)
