// The email design system's SAFETY CONTRACT, as tests.
//
// These aren't style assertions. Each rule below is something at least one major
// mail client silently drops — most of them Outlook, which renders with the Word
// engine rather than a browser. A change that reintroduces one won't look wrong
// in a browser preview, won't fail a typecheck, and won't be noticed until a
// mail lands in someone's inbox as an unstyled column. So the rules are pinned
// here instead.

import { test, expect, describe } from "bun:test"

import { bullets, callout, divider, findingList, keyValues, meter, paragraph, renderEmail, sectionTitle, statGrid } from "./layout"

// One document exercising every primitive, so the assertions cover them all.
const html = renderEmail({
    preheader: "A preview line",
    kicker: "Pull request review",
    heading: "Something happened",
    subheading: "acme · PR #7",
    chips: [
        { label: "changes requested", tone: "critical" },
        { label: "merge readiness 6/10", tone: "neutral" },
        { label: "2 blockers", tone: "critical" },
        { label: "2 to review", tone: "warning" },
    ],
    blocks: [
        paragraph("A lead paragraph.", { lead: true }),
        sectionTitle("A section"),
        callout({ title: "A panel", body: "With a body.", tone: "positive" }),
        meter({ label: "Merge readiness", value: 6, max: 10 }),
        statGrid([
            { label: "files", value: "6" },
            { label: "added", value: "+184", tone: "positive" },
        ]),
        bullets(["An item.", "Another item."]),
        keyValues([{ label: "Repository", value: "acme/acme" }]),
        findingList([{ tone: "critical", label: "blocker", title: "It breaks", detail: "Here's why.", location: "a.ts:3" }]),
        divider(),
    ],
    action: { label: "Open it", url: "https://app.example.com/x" },
    secondary: { label: "On GitHub →", url: "https://github.com/acme/acme/pull/7" },
    footerNote: "A note.",
})

describe("layout properties no mail client can be trusted with", () => {
    // Outlook's Word engine supports NEITHER. Multi-column layout is tables.
    test("no flexbox and no grid", () => {
        expect(html).not.toMatch(/display\s*:\s*(inline-)?flex/)
        expect(html).not.toMatch(/display\s*:\s*(inline-)?grid/)
        expect(html).not.toMatch(/\b(flex|grid)-(direction|wrap|template|column|row|gap|basis|grow|shrink)\b/)
        expect(html).not.toMatch(/\bgap\s*:/)
    })

    test("no float, positioning or transforms", () => {
        expect(html).not.toMatch(/[;"\s]float\s*:/)
        expect(html).not.toMatch(/position\s*:\s*(absolute|relative|fixed|sticky)/)
        // Anchored on the delimiter, not \b — `text-transform` is fine and has
        // a word boundary before "transform".
        expect(html).not.toMatch(/[;"\s]transform\s*:/)
        expect(html).not.toMatch(/z-index\s*:/)
        expect(html).not.toMatch(/calc\(/)
    })

    // Outlook.com rewrites shorthand declarations and can drop the whole rule,
    // which leaves the mail in Times New Roman.
    test("no `font:` shorthand — longhand only", () => {
        expect(html).not.toMatch(/[;"\s]font\s*:/)
        expect(html).toContain("font-family:")
        expect(html).toContain("font-size:")
    })

    // Word rounds unitless line-heights its own way; px + the mso rule pins them.
    test("line-heights are in px and pinned for Word", () => {
        const heights = [...html.matchAll(/line-height\s*:\s*([^;"!]+)/g)].map((m) => m[1].trim())
        expect(heights.length).toBeGreaterThan(10)
        // `0` is the spacer cells, which carry no text and want no leading.
        expect(heights.every((h) => h.endsWith("px") || h === "0")).toBe(true)
        expect(html).toContain("mso-line-height-rule:exactly")
    })
})

describe("nothing to fetch, nothing to block", () => {
    test("no remote assets, imports or scripts", () => {
        expect(html).not.toMatch(/url\(/)
        expect(html).not.toMatch(/background-image/)
        expect(html).not.toMatch(/@import/)
        expect(html).not.toMatch(/<script/i)
        expect(html).not.toMatch(/<link\b/i)
    })

    // The brand mark is the ONE subresource, and only because no other technique
    // renders a real logo in mail (inline SVG and data: URIs are both stripped).
    // A blocked image still draws the client's own placeholder — these rules are
    // what keep that placeholder inside the ember tile at the right size, instead
    // of collapsing the header.
    test("the only image is the brand mark, and a block stays contained", () => {
        const imgs = html.match(/<img[^>]*>/gi) ?? []
        expect(imgs.length).toBe(1)
        const img = imgs[0]
        expect(img).toContain("/email/ucelot-mark.png")
        // Empty alt: the wordmark beside it already reads "ucelot", so an alt of
        // "Ucelot" would print the name twice wherever the image doesn't load.
        expect(img).toMatch(/alt=""/)
        // Dimensions as ATTRIBUTES, so a client that blocks the image still
        // reserves the same box and the header doesn't reflow.
        expect(img).toMatch(/width="18"/)
        expect(img).toMatch(/height="17"/)
        // The ember tile is the CELL's background, never the image's — that is
        // what survives the block.
        expect(html).toMatch(/bgcolor="#e9730f"[^>]*>\s*<img/)
    })
})

describe("the Word-engine accommodations", () => {
    // Outlook ignores max-width; without the ghost table the mail stretches to
    // the whole window.
    test("the content column is wrapped in an mso ghost table", () => {
        expect(html).toContain(`<!--[if mso]><table role="presentation" width="600" align="center"`)
        expect(html).toContain("max-width:600px")
    })

    test("conditional comments are balanced and both branches carry the chips", () => {
        // The downlevel-revealed close (`<!--<![endif]-->`) also contains
        // `<![endif]-->`, so it has to be discounted before the two are compared.
        const opens = (html.match(/<!--\[if mso\]>/g) ?? []).length
        const closes = (html.match(/<!\[endif\]-->/g) ?? []).length - (html.match(/<!--<!\[endif\]-->/g) ?? []).length
        expect(closes).toBe(opens)
        // Word gets a table row of cells; everyone else gets wrapping spans.
        expect(html).toContain("<!--[if !mso]><!-->")
        expect(html).toContain("<!--<![endif]-->")
        expect(html).toContain("border-radius:999px")
    })

    test("backgrounds are set as attributes as well as CSS", () => {
        // Word honours bgcolor and ignores the rule.
        const bgcolors = (html.match(/bgcolor="/g) ?? []).length
        expect(bgcolors).toBeGreaterThan(5)
        expect(html).toContain('bgcolor="#e9730f"') // the CTA
        expect(html).toContain('bgcolor="#0a0d1c"') // the brand bar
    })

    test("every table carries the mso spacing reset", () => {
        const tables = (html.match(/<table/g) ?? []).length
        const resets = (html.match(/mso-table-lspace:0pt/g) ?? []).length
        // The ghost table is Outlook-only markup and needs no reset.
        expect(resets).toBeGreaterThanOrEqual(tables - 1)
    })

    // Word ignores padding on an inline <a>, so a padded-anchor button collapses
    // there into bare underlined text.
    test("the button's padding is on a table cell, not the anchor", () => {
        expect(html).toMatch(/<td align="center" bgcolor="#e9730f"[^>]*padding:13px 26px/)
    })
})

// The chip dot's alignment is geometry, which no unit test can measure — but it
// rests on three declarations that all look like tidy-up candidates, and losing
// any one of them puts the dot ~3.5px above the label's centre again (an
// inline-block with in-flow content is baseline-aligned to that content). So the
// declarations themselves are pinned.
describe("chip dot alignment", () => {
    const dot = /<span style="display:inline-block;vertical-align:middle;width:6px;height:6px;[^"]*"/

    test("the dot is vertical-align:middle with its font metrics zeroed", () => {
        const match = html.match(dot)
        expect(match).not.toBeNull()
        const style = match?.[0] ?? ""
        expect(style).toContain("vertical-align:middle")
        // Without these the &nbsp; inside the dot forms a line box, and THAT
        // line box's baseline is what gets aligned — lifting the dot.
        expect(style).toContain("font-size:0")
        expect(style).toContain("line-height:0")
    })

    test("every chip's dot carries the same alignment", () => {
        const dots = html.match(/<span style="display:inline-block;vertical-align:middle;width:6px/g) ?? []
        // Four chips in the fixture document above.
        expect(dots.length).toBe(4)
    })
})

describe("the shell's own contract", () => {
    test("a preheader is emitted and hidden", () => {
        expect(html).toContain("A preview line")
        expect(html).toMatch(/display:none[^"]*mso-hide:all/)
    })

    test("long values are allowed to break rather than widen the mail", () => {
        expect(html).toContain("word-break:break-word")
        expect(html).toContain("overflow-wrap:anywhere")
    })

    // The body's last block ends flush (every primitive pads only its top), and
    // the footer's own padding-top sits BELOW its border — so without this
    // spacer row the rule hugs the last line of copy at 0px. Verified: it was.
    test("a spacer row separates the body from the footer rule", () => {
        expect(html).toMatch(/<tr><td style="height:34px;font-size:0;line-height:0;">&nbsp;<\/td><\/tr>\s*<tr><td class="px rule"/)
    })

    test("the <style> block is polish, not layout", () => {
        const style = html.slice(html.indexOf("<style>"), html.indexOf("</style>"))
        // Only dark-mode and small-screen overrides belong in there; anything
        // structural has to be inline or it vanishes in Gmail's clipped view.
        expect(style).not.toMatch(/display\s*:\s*(flex|grid)/)
        expect(style.includes("@media")).toBe(true)
    })
})
