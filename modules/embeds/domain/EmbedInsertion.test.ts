import { test, expect, describe } from "bun:test"
import { embedMarkdown, insertEmbedReference } from "./EmbedInsertion"

const insert = (body: string, at: number, to = at) =>
    insertEmbedReference(body, at, to, "abc123", "Login button")

describe("embedMarkdown", () => {
    test("writes a reference, not a URL", () => {
        expect(embedMarkdown("abc123", "Login button")).toBe("![Login button](zoo:abc123)")
    })
    test("strips brackets that would terminate the alt early", () => {
        expect(embedMarkdown("abc123", "Login [hover] state")).toBe("![Login hover state](zoo:abc123)")
    })
    test("falls back to something meaningful rather than an empty alt", () => {
        // The image has no text layer; an empty alt leaves a screen reader nothing.
        expect(embedMarkdown("abc123", "   ")).toBe("![Component preview](zoo:abc123)")
    })
})

describe("insertEmbedReference", () => {
    test("separates the reference from the paragraph above, or it renders mid-sentence", () => {
        const { text } = insert("Repro steps:", 12)
        expect(text).toBe("Repro steps:\n\n![Login button](zoo:abc123)\n")
    })

    test("does not add padding that is already there", () => {
        expect(insert("Repro:\n\n", 8).text).toBe("Repro:\n\n![Login button](zoo:abc123)\n")
        expect(insert("Repro:\n", 7).text).toBe("Repro:\n\n![Login button](zoo:abc123)\n")
    })

    test("inserting twice does not walk the body downwards", () => {
        const once = insert("Repro:", 6)
        const twice = insertEmbedReference(once.text, once.caret, once.caret, "def456", "Modal")
        expect(twice.text).toBe("Repro:\n\n![Login button](zoo:abc123)\n\n![Modal](zoo:def456)\n")
    })

    test("splits a paragraph when the caret is inside one", () => {
        const { text } = insert("beforeafter", 6)
        expect(text).toBe("before\n\n![Login button](zoo:abc123)\n\nafter")
    })

    test("replaces a selection", () => {
        expect(insert("keep DROP keep", 5, 9).text).toBe("keep \n\n![Login button](zoo:abc123)\n\n keep")
    })

    test("leaves the caret just past the reference, ready to keep typing", () => {
        const { text, caret } = insert("Repro:", 6)
        expect(text.slice(0, caret)).toBe("Repro:\n\n![Login button](zoo:abc123)")
    })

    test("an empty body needs no leading padding", () => {
        expect(insert("", 0).text).toBe("![Login button](zoo:abc123)\n")
    })

    test("tolerates an out-of-range or absent caret", () => {
        expect(insert("body", 999).text).toBe("body\n\n![Login button](zoo:abc123)\n")
        expect(insert("body", NaN).text).toBe("body\n\n![Login button](zoo:abc123)\n")
    })
})
