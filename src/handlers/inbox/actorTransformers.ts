import type { SolidFetch } from '../../types/index.js'

export type ActorTransformer = (
  activity: Record<string, unknown>,
  fetch: SolidFetch
) => Promise<Record<string, unknown>>

const actorTransformers: Map<string, ActorTransformer> = new Map()

export function registerActorTransformer(
  actor: string, 
  transformer: ActorTransformer
): void {
  actorTransformers.set(actor, transformer)
}

export async function applyActorTransformer(
  activity: Record<string, unknown>,
  fetch: SolidFetch
): Promise<Record<string, unknown> | null> {
  const actor = activity.actor as string | undefined
  if (actor && actorTransformers.has(actor)) {
    return actorTransformers.get(actor)!(activity, fetch)
  }
  return null
}
