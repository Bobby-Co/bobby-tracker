"use client"

import { useState } from "react"
import type { SignedEmbed } from "@/modules/embeds/domain/SignedEmbed"

// One Zoo component render, embedded in an issue.
//
// The <img> is the whole integration: an image element cannot send an
// Authorization header, so the credential travels in the URL and the server
// put it there before this ever reached the browser. Nothing here can produce a
// src — if `embed` is missing or carries none, the answer is a placeholder, not
// a fallback request.
//
// Three things the upstream contract (§8) asks of the rendering side and this
// component owes it:
//
//   · width/height from Zoo's metadata, so the page doesn't reflow when the
//     image lands. They're attributes, not CSS, so the browser reserves the box
//     from the aspect ratio while `max-w-full h-auto` keeps it responsive.
//   · a surface behind it. The render has a TRANSPARENT background and is
//     theme-baked — it will not adapt to ours — so it sits on a fixed, gentle
//     surface that reads in both our themes rather than on the page ground.
//   · a real alt. The image has no text layer, so alt is everything a screen
//     reader gets.

export function ZooEmbed({
    embed,
    alt,
    title,
}: {
    /** Null when this surface didn't sign — the id was never resolved. */
    embed: SignedEmbed | null
    alt: string
    title?: string
}) {
    // A 403 (clock skew, key rotation) or a 410 that landed after we signed
    // arrives here as a load error and nothing else — an <img> gives the page
    // no status code to read.
    const [failed, setFailed] = useState(false)

    if (!embed || !embed.src || failed) {
        return <EmbedPlaceholder reason={placeholderReason(embed, failed)} alt={alt} />
    }

    return (
        <span className="my-1 inline-block max-w-full overflow-hidden rounded-[10px] border border-[color:var(--c-border)] bg-[color:var(--c-surface-2)] p-2 align-middle">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
                src={embed.src}
                alt={alt}
                title={title}
                width={embed.w ?? undefined}
                height={embed.h ?? undefined}
                loading="lazy"
                decoding="async"
                onError={() => setFailed(true)}
                className="block h-auto max-w-full"
            />
        </span>
    )
}

type PlaceholderReason = "removed" | "unavailable" | "unsigned"

function placeholderReason(embed: SignedEmbed | null, failed: boolean): PlaceholderReason {
    if (!embed) return "unsigned"
    if (embed.state === "revoked") return "removed"
    if (failed || embed.state === "missing") return "unavailable"
    return "unavailable"
}

const REASON_TEXT: Record<PlaceholderReason, string> = {
    // Zoo's 410: the owner revoked it. Deliberate, permanent, and not worth a retry.
    removed: "Image removed",
    // Zoo's 404, or a load that failed after we signed.
    unavailable: "Image unavailable",
    // A surface that renders bodies but doesn't sign embeds — the reference is
    // intact, it just wasn't resolved here.
    unsigned: "Component preview",
}

function EmbedPlaceholder({ reason, alt }: { reason: PlaceholderReason; alt: string }) {
    return (
        <span
            role="img"
            aria-label={alt ? `${REASON_TEXT[reason]}: ${alt}` : REASON_TEXT[reason]}
            className="my-1 inline-flex max-w-full flex-col gap-0.5 rounded-[10px] border border-dashed border-[color:var(--c-border)] bg-[color:var(--c-surface-2)] px-3 py-2 align-middle text-[11.5px] text-[color:var(--c-text-muted)]"
        >
            <span className="font-semibold">{REASON_TEXT[reason]}</span>
            {alt ? <span className="truncate text-[color:var(--c-text-dim)]">{alt}</span> : null}
        </span>
    )
}
