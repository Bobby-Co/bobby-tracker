// Role: freeze one component into a pinned embed.
//
// The write half of the integration. Minting is not idempotent-free: it costs a
// headless render on the developer's machine, so it happens once, when an author
// picks a component — never on a page render.

/** Why a mint didn't produce an embed. Mirrors Zoo's structured reasons, which
 *  exist so the UI can say something useful instead of "failed": `empty` means
 *  the component renders nothing until its props are wired, `offline` means the
 *  developer's daemon isn't running and the author should try later. */
export type MintFailure =
    | "offline"
    | "empty"
    | "toobig"
    | "unknown-component"
    | "unclaimed"
    | "not-found"
    | "not-granted"
    | "scope-not-granted"
    | "error"

export type MintResult =
    | { ok: true; embedId: string; componentId: string; w: number | null; h: number | null }
    | { ok: false; reason: MintFailure }

export interface EmbedMinter {
    mint(input: {
        repoUrl: string
        componentId: string
        presetKey?: string
        /** The tenant we are acting for — see ComponentCatalog.forRepo. */
        subject: string
    }): Promise<MintResult>
}
