// Role: what components can this project embed?
//
// Answered by Zoo's `/api/catalogue`, keyed by the project's git remote — the
// one identifier both sides already share, so neither has to learn the other's
// project ids.

import type { ZooCatalogue } from "../domain/ZooComponent"

export interface ComponentCatalog {
    /** The catalogue for a repo, or null when Zoo has no project for it (or
     *  can't be reached). Never throws — an unreachable Zoo is an empty picker,
     *  not a broken editor. */
    forRepo(repoUrl: string): Promise<ZooCatalogue | null>
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
    thumbnail(repoUrl: string, componentId: string): Promise<ThumbnailResult>
}
