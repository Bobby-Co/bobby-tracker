// Zoo's `/api/catalogue` — "what components does this repo have?"
//
// Keyed by the project's git remote, which we already store per project, so
// neither side has to learn the other's project ids. Zoo answers from its
// cached manifest, so this keeps working when the developer's daemon is offline
// — the list stays browsable even when nothing can be minted from it, which is
// why `online` travels with the components rather than gating them.

import { normalizeRepoUrl } from "../domain/RepoKey"
import type { ZooComponent } from "../domain/ZooComponent"
import type {
    CatalogueOutcome,
    ComponentCatalog,
    ComponentThumbnails,
    ThumbnailResult,
} from "../ports/ComponentCatalog"
import type { ZooRepoTokens } from "./ZooRepoTokens"

const TIMEOUT_MS = 4000
/** Thumbnails tunnel to the developer's machine, so allow a little longer. */
const THUMBNAIL_TIMEOUT_MS = 8000

export class ZooComponentCatalog implements ComponentCatalog, ComponentThumbnails {
    constructor(
        private readonly origin: string,
        private readonly tokens: ZooRepoTokens,
        /** Workers' fetch sends no User-Agent unless told to. */
        private readonly userAgent = "bobby-tracker",
    ) {}

    async forRepo(repoUrl: string, subject: string): Promise<CatalogueOutcome> {
        const repoKey = normalizeRepoUrl(repoUrl)
        if (!repoKey) return { status: "unavailable" }

        try {
            // The token is bound to the NORMALIZED key; the query carries the raw
            // remote and Zoo normalizes it the same way. Sending the normalized
            // form in both would work too — this way a mismatch surfaces as a
            // signature failure rather than silently reading another repo.
            const token = await this.tokens.bearer("catalogue", repoKey, subject)
            const url =
                `${this.origin}/api/catalogue?repo=${encodeURIComponent(repoUrl)}` +
                `&subject=${encodeURIComponent(subject)}`
            const response = await fetch(url, {
                headers: { authorization: `Bearer ${token}`, accept: "application/json", "user-agent": this.userAgent },
                signal: AbortSignal.timeout(TIMEOUT_MS),
            })
            if (response.status === 403) {
                // Signed correctly, but this project has no consent from the
                // repo's owner. Distinct from "Zoo doesn't know this repo".
                return { status: "not-connected" }
            }
            if (!response.ok) return { status: "unavailable" }

            const body = (await response.json()) as Record<string, unknown>
            return {
                status: "ok",
                catalogue: {
                    repo: typeof body.repo === "string" ? body.repo : repoKey,
                    project: typeof body.project === "string" ? body.project : "",
                    online: body.online === true,
                    components: toComponents(body.components),
                },
            }
        } catch {
            // Unreachable Zoo, timeout, bad JSON — all the same to a picker.
            return { status: "unavailable" }
        }
    }

    /** One component's palette thumbnail. Cheap and unpinned — this is the
     *  preview the studio already renders, NOT a mint: nothing is frozen and
     *  nothing is persisted, so browsing the picker costs no embeds. */
    async thumbnail(repoUrl: string, componentId: string, subject: string): Promise<ThumbnailResult> {
        const repoKey = normalizeRepoUrl(repoUrl)
        if (!repoKey) return { status: "unavailable" }

        try {
            const token = await this.tokens.bearer("catalogue", repoKey, subject)
            const url =
                `${this.origin}/api/catalogue/thumb/${encodeURIComponent(componentId)}` +
                `?repo=${encodeURIComponent(repoUrl)}&subject=${encodeURIComponent(subject)}`
            const response = await fetch(url, {
                headers: { authorization: `Bearer ${token}`, accept: "image/webp,*/*", "user-agent": this.userAgent },
                signal: AbortSignal.timeout(THUMBNAIL_TIMEOUT_MS),
            })
            // 202: the daemon has started rendering it. Distinct from a failure,
            // because the right response is to ask again shortly.
            if (response.status === 202) return { status: "pending" }
            if (!response.ok) return { status: "unavailable" }
            return {
                status: "ready",
                bytes: await response.arrayBuffer(),
                contentType: response.headers.get("content-type") ?? "image/webp",
            }
        } catch {
            return { status: "unavailable" }
        }
    }
}

function toComponents(raw: unknown): ZooComponent[] {
    if (!Array.isArray(raw)) return []
    return raw.flatMap((entry) => {
        const c = entry as Record<string, unknown>
        if (typeof c?.id !== "string") return []
        return [
            {
                id: c.id,
                name: typeof c.name === "string" ? c.name : c.id,
                description: typeof c.description === "string" ? c.description : "",
                file: typeof c.file === "string" ? c.file : "",
            },
        ]
    })
}
