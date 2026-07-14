import { isBadgeTone, renderBadge } from "@/lib/badge"

// GET /api/badge?text=<label>&tone=<tone>&dot=<0|1>
//
// PUBLIC (no auth) — GitHub camo fetches this server-side to render the chips in
// our issue/PR analysis comments, so it must be reachable unauthenticated, like
// the webhook. Returns a brand-styled SVG pill (see lib/badge.ts). Deterministic
// per query, so it caches hard; a status change points at a different URL.
export const dynamic = "force-dynamic"

export function GET(request: Request) {
    const { searchParams } = new URL(request.url)
    const text = searchParams.get("text") ?? ""
    const toneParam = searchParams.get("tone") ?? "zinc"
    const tone = isBadgeTone(toneParam) ? toneParam : "zinc"
    const dot = searchParams.get("dot") !== "0"

    const svg = renderBadge(text, tone, { dot })

    return new Response(svg, {
        headers: {
            "Content-Type": "image/svg+xml; charset=utf-8",
            // Long, per-URL cache: chip content is fully determined by the query,
            // and a state change swaps to a new URL, so this never goes stale.
            "Cache-Control": "public, max-age=86400, s-maxage=86400",
        },
    })
}
