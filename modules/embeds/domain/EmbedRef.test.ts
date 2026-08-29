import { test, expect, describe } from "bun:test"
import { EmbedId } from "./EmbedId"
import { collectEmbedIds, embedRef, parseEmbedRef, parsePastedEmbedId } from "./EmbedRef"

describe("collectEmbedIds", () => {
    test("finds image references in a body", () => {
        const body = "Before\n\n![Login button](zoo:Zm9vYmFy)\n\nAfter ![Modal](zoo:YmF6cXV4)\n"
        expect(collectEmbedIds(body)).toEqual(["Zm9vYmFy", "YmF6cXV4"])
    })

    test("finds a plain link target too — same position react-markdown reads", () => {
        expect(collectEmbedIds("see [the render](zoo:abc123)")).toEqual(["abc123"])
    })

    test("tolerates a markdown title after the target", () => {
        expect(collectEmbedIds('![alt](zoo:abc123 "The login button")')).toEqual(["abc123"])
    })

    test("dedupes, so one embed used twice is signed once", () => {
        expect(collectEmbedIds("![a](zoo:abc) and again ![b](zoo:abc)")).toEqual(["abc"])
    })

    test("ignores a zoo: id mentioned in prose — only a link target is an embed", () => {
        expect(collectEmbedIds("the id is zoo:abc123, paste it in")).toEqual([])
    })

    test("over-collects from a code fence, and that is deliberate", () => {
        // We scan text, not a parsed AST, so a reference shown inside a fence is
        // collected and signed even though react-markdown will render it as
        // code and never request it. Over-collecting costs a signature;
        // under-collecting would cost a missing image, so this is the safe side
        // of the trade.
        expect(collectEmbedIds("```md\n![alt](zoo:abc)\n```")).toEqual(["abc"])
    })

    test("ignores ordinary images", () => {
        expect(collectEmbedIds("![shot](https://example.com/a.png)")).toEqual([])
    })

    test("is bounded — a body cannot fan out unboundedly on the render path", () => {
        const body = Array.from({ length: 100 }, (_, i) => `![a](zoo:id${i})`).join("\n")
        expect(collectEmbedIds(body)).toHaveLength(32)
    })

    test("empty and null bodies cost nothing", () => {
        expect(collectEmbedIds("")).toEqual([])
        expect(collectEmbedIds(null)).toEqual([])
    })
})

describe("parseEmbedRef", () => {
    test("round-trips embedRef", () => {
        expect(parseEmbedRef(embedRef("Zm9vYmFy"))).toBe("Zm9vYmFy")
    })
    test("returns null for a real URL, so ordinary images render untouched", () => {
        expect(parseEmbedRef("https://example.com/a.png")).toBeNull()
        expect(parseEmbedRef(undefined)).toBeNull()
    })
    test("returns null for a zoo: ref with a malformed id", () => {
        expect(parseEmbedRef("zoo:has spaces")).toBeNull()
        expect(parseEmbedRef("zoo:")).toBeNull()
    })
})

describe("EmbedId", () => {
    test("accepts the base64url alphabet Zoo mints", () => {
        expect(EmbedId.parse("Zm9vYmFyMTIzNDU2Nzg5")?.value).toBe("Zm9vYmFyMTIzNDU2Nzg5")
        expect(EmbedId.parse("a-b_c")?.value).toBe("a-b_c")
    })
    test("rejects anything that would escape its URL path segment or the payload join", () => {
        for (const bad of ["a.b", "a/b", "a?b", "a#b", "a b", "", "x".repeat(129)]) {
            expect(EmbedId.parse(bad)).toBeNull()
        }
    })
})

describe("parsePastedEmbedId", () => {
    test("takes a bare id", () => {
        expect(parsePastedEmbedId("  Zm9vYmFy  ")).toBe("Zm9vYmFy")
    })
    test("takes one of our own references", () => {
        expect(parsePastedEmbedId("zoo:Zm9vYmFy")).toBe("Zm9vYmFy")
    })
    test("takes a Zoo URL and KEEPS ONLY THE ID", () => {
        // The point of the exercise: a signed URL is a bearer token, and the
        // body must never end up holding one.
        const signed = "https://zoo.example/e/Zm9vYmFy.webp?kid=issues-prod-1&exp=1800001800&sig=AAAA"
        expect(parsePastedEmbedId(signed)).toBe("Zm9vYmFy")
        expect(parsePastedEmbedId("https://zoo.example/e/Zm9vYmFy.json")).toBe("Zm9vYmFy")
        expect(parsePastedEmbedId("/e/Zm9vYmFy.webp")).toBe("Zm9vYmFy")
    })
    test("null for anything else", () => {
        expect(parsePastedEmbedId("")).toBeNull()
        expect(parsePastedEmbedId("https://example.com/cat.png")).toBeNull()
        expect(parsePastedEmbedId("two words")).toBeNull()
    })
})
