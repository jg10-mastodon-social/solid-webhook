export const INSERT_DELETE_PATCH_PREFIX = `@prefix as: <https://www.w3.org/ns/activitystreams#>.
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>.
@prefix solid: <http://www.w3.org/ns/solid/terms#>.
`

export function buildInsertDeletePatch(
  itemTurtle: string,
  itemId: string,
  pageUrl: string
): string {
  const patch = `${INSERT_DELETE_PATCH_PREFIX}
      _:patch a solid:InsertDeletePatch;
      solid:inserts {
			      <${itemId}> as:items <${itemId}>.
       ${itemTurtle}
     }.
`
  return patch
}