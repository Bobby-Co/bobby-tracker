// The picker's use case: browse a project's Zoo components, and freeze one.
//
// Two steps with very different costs, which is why they are separate calls and
// not one:
//
//   list()  — cheap, cached by Zoo, works with the developer's daemon offline.
//   pick()  — expensive: a real headless render on the developer's machine.
//             Happens once, when an author chooses, and never on a page render.
//
// `pick` returns a SIGNED embed, so the editor can show the image it just
// created without a second round trip. That signature is as short-lived as any
// other — it is a preview, not something to persist.

import type { SignedEmbed } from "../domain/SignedEmbed"
import type { ZooCatalogue } from "../domain/ZooComponent"
import type { ComponentCatalog, ComponentThumbnails, ThumbnailResult } from "../ports/ComponentCatalog"
import type { EmbedMinter, MintFailure } from "../ports/EmbedMinter"
import type { EmbedSigningService } from "./EmbedSigningService"

export type PickResult =
    | { ok: true; embed: SignedEmbed }
    | { ok: false; reason: MintFailure }

export class ComponentPickerService {
    constructor(
        private readonly catalog: ComponentCatalog,
        private readonly minter: EmbedMinter,
        private readonly signing: EmbedSigningService,
        private readonly thumbnails: ComponentThumbnails | null = null,
    ) {}

    /** A component's preview, for the picker's list. Cheap and unpinned —
     *  browsing must never mint. */
    async thumbnail(repoUrl: string, componentId: string): Promise<ThumbnailResult> {
        if (!this.thumbnails) return { status: "unavailable" }
        return this.thumbnails.thumbnail(repoUrl, componentId)
    }

    /** What this project can embed. Null when Zoo has no project for the repo. */
    async list(repoUrl: string): Promise<ZooCatalogue | null> {
        return this.catalog.forRepo(repoUrl)
    }

    /** Freeze one component and hand back something renderable. */
    async pick(input: { repoUrl: string; componentId: string; presetKey?: string }): Promise<PickResult> {
        const minted = await this.minter.mint(input)
        if (!minted.ok) return { ok: false, reason: minted.reason }

        // Sign what we just minted. Going back through the signing service (and
        // so through Zoo's metadata) rather than trusting the mint response
        // keeps ONE definition of a renderable embed — the picker cannot end up
        // showing something the issue page would render differently.
        const signed = await this.signing.forIds([minted.embedId])
        const embed = signed[minted.embedId]
        if (!embed) return { ok: false, reason: "error" }
        return { ok: true, embed }
    }
}
