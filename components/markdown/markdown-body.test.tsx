// What the browser actually receives for a `zoo:` reference.
//
// The regression this exists for: react-markdown sanitizes URLs against a
// protocol allowlist, and `zoo:` is not on it. Before `urlTransform` was
// widened, every embed reached the img renderer as an empty string and rendered
// as a broken image — with signing, dimensions and access control all working
// perfectly upstream of it. Nothing in the module tests could see that.

import { test, expect, describe } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import { MarkdownBody } from "./markdown-body"
import type { SignedEmbedMap } from "@/modules/embeds/domain/SignedEmbed"

const SIGNED = "https://zoo.example/e/Zm9vYmFy.webp?kid=k&exp=1800001800&sig=SIG"

const embeds: SignedEmbedMap = {
    Zm9vYmFy: { embedId: "Zm9vYmFy", src: SIGNED, w: 320, h: 200, state: "ok" },
    Revoked1: { embedId: "Revoked1", src: null, w: null, h: null, state: "revoked" },
    Missing1: { embedId: "Missing1", src: null, w: null, h: null, state: "missing" },
}

const render = (markdown: string, map?: SignedEmbedMap) =>
    renderToStaticMarkup(<MarkdownBody embeds={map}>{markdown}</MarkdownBody>)

describe("MarkdownBody — zoo embeds", () => {
    test("renders a signed embed as an img with the signed src", () => {
        const html = render("![Login button](zoo:Zm9vYmFy)", embeds)
        expect(html).toContain(`src="${SIGNED.replace(/&/g, "&amp;")}"`)
        expect(html).toContain('alt="Login button"')
    })

    test("reserves space from Zoo's dimensions so the page does not reflow", () => {
        const html = render("![x](zoo:Zm9vYmFy)", embeds)
        expect(html).toContain('width="320"')
        expect(html).toContain('height="200"')
    })

    test("a revoked embed renders words, not a request", () => {
        const html = render("![Old modal](zoo:Revoked1)", embeds)
        expect(html).toContain("Image removed")
        expect(html).not.toContain("<img")
    })

    test("a missing embed renders a placeholder too", () => {
        expect(render("![x](zoo:Missing1)", embeds)).toContain("Image unavailable")
    })

    test("an unsigned surface never emits a src — the reference stays inert", () => {
        // The drawer path. A `zoo:` URL is unfetchable by any browser, so the
        // failure mode here is a placeholder, never an unauthenticated request.
        const html = render("![Login button](zoo:Zm9vYmFy)")
        expect(html).not.toContain("<img")
        expect(html).not.toContain("zoo:")
        expect(html).toContain("Component preview")
    })

    test("the alt text survives into the placeholder's label", () => {
        expect(render("![Login button](zoo:Revoked1)", embeds)).toContain(
            'aria-label="Image removed: Login button"',
        )
    })
})

describe("MarkdownBody — everything else still renders", () => {
    test("an ordinary image is untouched", () => {
        const html = render("![shot](https://example.com/a.png)")
        expect(html).toContain('src="https://example.com/a.png"')
    })

    test("widening the allowlist for zoo: did not widen it for anything else", () => {
        // The reason urlTransform is a delegation and not a replacement.
        expect(render("[click](javascript:alert(1))")).not.toContain("javascript:")
        expect(render("![x](javascript:alert(1))")).not.toContain("javascript:")
    })

    test("gfm is still on", () => {
        expect(render("| a | b |\n| - | - |\n| 1 | 2 |")).toContain("<table>")
    })
})
