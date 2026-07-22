import { gaugeSvg } from "@/lib/shared/rendering/badge"

// GET /api/gauge?kind=score&value=6&max=10  |  ?kind=confidence&levels=high,medium,low
//
// PUBLIC (no auth) — GitHub camo fetches this server-side to render the readiness
// score + confidence meters in our PR/issue comments, like /api/badge. Returns a
// segmented-bar SVG (see lib/badge.ts). Deterministic per query → caches hard.
export const dynamic = "force-dynamic"

export function GET(request: Request) {
    const { searchParams } = new URL(request.url)
    const svg = gaugeSvg(searchParams)
    return new Response(svg, {
        headers: {
            "Content-Type": "image/svg+xml; charset=utf-8",
            "Cache-Control": "public, max-age=86400, s-maxage=86400",
        },
    })
}
