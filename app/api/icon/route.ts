import { isBadgeTone, renderIcon } from "@/lib/badge"

// GET /api/icon?name=<glyph>&tone=<tone>
//
// PUBLIC (no auth) — GitHub camo fetches this server-side to render the small
// line-icons that prefix our PR-comment section headers, matching the in-app
// glyphs. Deterministic per query, so it caches hard.
export const dynamic = "force-dynamic"

export function GET(request: Request) {
    const { searchParams } = new URL(request.url)
    const name = searchParams.get("name") ?? "search"
    const toneParam = searchParams.get("tone") ?? "zinc"
    const tone = isBadgeTone(toneParam) ? toneParam : "zinc"

    const svg = renderIcon(name, tone)

    return new Response(svg, {
        headers: {
            "Content-Type": "image/svg+xml; charset=utf-8",
            "Cache-Control": "public, max-age=86400, s-maxage=86400",
        },
    })
}
