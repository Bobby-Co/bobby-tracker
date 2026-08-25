// Rebuild the brand mark that the email header renders.
//
// Why this exists rather than a checked-in image nobody can regenerate: the mark
// is defined ONCE, as BOBBY_MARK_PATH in components/layout/brand-lockup.tsx, and
// the app draws it as inline SVG. Email cannot — Gmail and Outlook both strip
// inline <svg>, and both block data: URIs — so the header needs a real raster
// file. This reads the same path the app uses and rasterises it, so the mail can
// never end up carrying a mark the product has moved on from.
//
// White on TRANSPARENT, deliberately: the ember tile behind it is the table
// cell's own bgcolor, so the mark's cut-outs (the eyes and mouth) show ember,
// and a client that blocks the image leaves a plain ember tile rather than a
// hole. Rendered at 4× its 18px display size for retina.
//
// Requires rsvg-convert (brew install librsvg).
//
// Run with:
//   bun scripts/build-email-mark.ts

import { execFileSync } from "node:child_process"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const ROOT = join(__dirname, "..")
const OUT_DIR = join(ROOT, "public", "email")
const SVG = join(OUT_DIR, "ucelot-mark.svg")
const PNG = join(OUT_DIR, "ucelot-mark.png")

// The mark's own coordinate system, from brand-lockup.tsx's <svg viewBox>.
const VIEWBOX = { w: 106, h: 102 }
// 4× the 18×17 the header renders it at.
const OUT = { w: 72, h: 69 }

const source = readFileSync(join(ROOT, "components", "layout", "brand-lockup.tsx"), "utf8")
const match = source.match(/BOBBY_MARK_PATH\s*=\s*\n?\s*"([^"]+)"/)
if (!match) {
    console.error("Couldn't find BOBBY_MARK_PATH in components/layout/brand-lockup.tsx.")
    process.exit(1)
}

mkdirSync(OUT_DIR, { recursive: true })
writeFileSync(
    SVG,
    `<svg xmlns="http://www.w3.org/2000/svg" width="${VIEWBOX.w}" height="${VIEWBOX.h}" viewBox="0 0 ${VIEWBOX.w} ${VIEWBOX.h}">
  <path fill="#ffffff" d="${match[1]}"/>
</svg>
`,
)

try {
    execFileSync("rsvg-convert", ["-w", String(OUT.w), "-h", String(OUT.h), SVG, "-o", PNG])
} catch {
    console.error("rsvg-convert failed or isn't installed — try: brew install librsvg")
    process.exit(1)
}

console.log(`Wrote ${PNG} (${OUT.w}×${OUT.h}, displayed at 18×17)`)
console.log("Served to mail as ${NEXT_PUBLIC_APP_URL}/email/ucelot-mark.png")
