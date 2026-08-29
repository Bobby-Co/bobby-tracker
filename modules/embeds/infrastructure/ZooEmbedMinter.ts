// Zoo's `POST /api/embeds` — freeze one component into a pinned image.
//
// The one call in this module that COSTS something: Zoo asks the developer's
// daemon to drive a headless browser and screenshot the component. So it
// happens once, when an author picks a component, and never on a page render.
//
// Zoo's failure reasons are preserved rather than flattened, because they are
// the difference between "try again in a minute" (the daemon is asleep) and
// "wire some data first" (the component renders nothing empty) — advice the
// author can act on, which "mint failed" is not.

import { normalizeRepoUrl } from "../domain/RepoKey"
import type { EmbedMinter, MintFailure, MintResult } from "../ports/EmbedMinter"
import type { ZooRepoTokens } from "./ZooRepoTokens"

/** A render can take seconds — a browser has to start, lay out and screenshot. */
const TIMEOUT_MS = 30_000

const KNOWN_REASONS = new Set<MintFailure>([
    "offline",
    "empty",
    "toobig",
    "unknown-component",
    "unclaimed",
    "not-found",
    // Zoo's word for "the repo owner has not connected this project" — the one
    // failure the author can actually fix, so it must not flatten to "error".
    "not-granted",
    // Connected, but only for reading the catalogue — a different fix for the
    // author than "not connected at all", so it keeps its own name.
    "scope-not-granted",
    "error",
])

export class ZooEmbedMinter implements EmbedMinter {
    constructor(
        private readonly origin: string,
        private readonly tokens: ZooRepoTokens,
        private readonly userAgent = "bobby-tracker",
    ) {}

    async mint(input: { repoUrl: string; componentId: string; presetKey?: string; subject: string }): Promise<MintResult> {
        const repoKey = normalizeRepoUrl(input.repoUrl)
        if (!repoKey) return { ok: false, reason: "not-found" }

        try {
            const token = await this.tokens.bearer("mint", repoKey, input.subject)
            const response = await fetch(`${this.origin}/api/embeds`, {
                method: "POST",
                headers: {
                    authorization: `Bearer ${token}`,
                    "content-type": "application/json",
                    "user-agent": this.userAgent,
                },
                body: JSON.stringify({
                    repo: input.repoUrl,
                    componentId: input.componentId,
                    presetKey: input.presetKey ?? "",
                    subject: input.subject,
                }),
                signal: AbortSignal.timeout(TIMEOUT_MS),
            })

            const body = (await response.json().catch(() => ({}))) as Record<string, unknown>
            if (!response.ok) {
                const reason = typeof body.reason === "string" ? body.reason : ""
                const mapped = KNOWN_REASONS.has(reason as MintFailure) ? (reason as MintFailure) : "error"
                // `unclaimed` arrives as the error field rather than the reason.
                return { ok: false, reason: body.error === "unclaimed" ? "unclaimed" : mapped }
            }
            if (typeof body.embedId !== "string") return { ok: false, reason: "error" }

            return {
                ok: true,
                embedId: body.embedId,
                componentId: typeof body.componentId === "string" ? body.componentId : input.componentId,
                w: typeof body.w === "number" ? body.w : null,
                h: typeof body.h === "number" ? body.h : null,
            }
        } catch {
            return { ok: false, reason: "error" }
        }
    }
}
