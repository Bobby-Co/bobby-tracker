// Role: what components can this project embed?
//
// Answered by Zoo's `/api/catalogue`, keyed by the project's git remote — the
// one identifier both sides already share, so neither has to learn the other's
// project ids.

import type { ZooCatalogue } from "../domain/ZooComponent"

/** Why there is no catalogue to show.
 *
 *  `not-connected` is deliberately distinct from `unavailable`: it is the one
 *  the user can act on, and telling them "Zoo has no project for this repo"
 *  when the truth is "nobody approved you yet" sends them to fix the wrong
 *  thing. */
export type CatalogueOutcome =
    | { status: "ok"; catalogue: ZooCatalogue }
    | { status: "not-connected" }
    | { status: "unavailable" }

export interface ComponentCatalog {
    /** The catalogue for a repo. Never throws — an unreachable Zoo is an empty
     *  picker, not a broken editor.
     *
     *  `subject` names the tenant we are acting for. Zoo records consent per
     *  (app, tenant, repo), so it is not optional context — it is half of what
     *  decides whether this call is allowed at all. */
    forRepo(repoUrl: string, subject: string): Promise<CatalogueOutcome>
}

/** A component's palette preview, as the picker needs it.
 *
 *  `pending` is not a failure: thumbnails are rendered lazily on the developer's
 *  machine, so the first ask for one schedules it and the caller comes back. */
export type ThumbnailResult =
    | { status: "ready"; bytes: ArrayBuffer; contentType: string }
    | { status: "pending" }
    | { status: "unavailable" }

export interface ComponentThumbnails {
    /** The preview for one component. Never throws. */
    thumbnail(repoUrl: string, componentId: string, subject: string): Promise<ThumbnailResult>
}
