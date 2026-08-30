import { test, expect, describe } from "bun:test"
import {
    splitBlocks,
    joinBlocks,
    lineAt,
    caretInFence,
    listItem,
    nextListPrefix,
} from "./MarkdownBlocks"

describe("splitBlocks", () => {
    test("splits on blank lines", () => {
        expect(splitBlocks("# Title\n\nA paragraph.\n\n- one\n- two")).toEqual([
            "# Title",
            "A paragraph.",
            "- one\n- two",
        ])
    })

    test("keeps a soft-wrapped paragraph as one block", () => {
        expect(splitBlocks("line one\nline two")).toEqual(["line one\nline two"])
    })

    test("collapses runs of blank lines and trailing blanks", () => {
        expect(splitBlocks("a\n\n\n\nb\n\n\n")).toEqual(["a", "b"])
    })

    test("keeps a fenced code block atomic, blank lines and all", () => {
        const doc = "before\n\n```ts\nconst x = 1\n\nconst y = 2\n```\n\nafter"
        expect(splitBlocks(doc)).toEqual([
            "before",
            "```ts\nconst x = 1\n\nconst y = 2\n```",
            "after",
        ])
    })

    test("closes a tilde fence only on a matching marker", () => {
        const doc = "~~~\n```\nnot a close\n~~~"
        expect(splitBlocks(doc)).toEqual(["~~~\n```\nnot a close\n~~~"])
    })

    test("normalizes CRLF", () => {
        expect(splitBlocks("a\r\n\r\nb")).toEqual(["a", "b"])
    })

    test("empty document yields no blocks", () => {
        expect(splitBlocks("")).toEqual([])
        expect(splitBlocks("\n\n  \n")).toEqual([])
    })
})

describe("joinBlocks", () => {
    test("round-trips a split document, normalizing separators", () => {
        const doc = "# Title\n\nA paragraph.\n\n- one\n- two"
        expect(joinBlocks(splitBlocks(doc))).toBe(doc)
    })

    test("drops empty blocks and separates with a single blank line", () => {
        expect(joinBlocks(["a", "", "  ", "b"])).toBe("a\n\nb")
    })

    test("preserves interior blank lines of a code block", () => {
        const code = "```\nx\n\ny\n```"
        expect(joinBlocks([code, "after"])).toBe(`${code}\n\nafter`)
    })
})

describe("lineAt", () => {
    test("finds the line the caret sits on", () => {
        const text = "one\ntwo\nthree"
        expect(lineAt(text, 5)).toEqual({ start: 4, end: 7, line: "two" })
    })

    test("handles the first and last lines", () => {
        const text = "one\ntwo"
        expect(lineAt(text, 0).line).toBe("one")
        expect(lineAt(text, 7).line).toBe("two")
    })
})

describe("caretInFence", () => {
    const block = "```ts\nconst x = 1\n```"
    test("is true inside the fence", () => {
        expect(caretInFence(block, 10)).toBe(true)
    })
    test("is false once the fence closed", () => {
        expect(caretInFence(block, block.length)).toBe(false)
    })
    test("is false with no fence", () => {
        expect(caretInFence("plain text", 4)).toBe(false)
    })
})

describe("listItem", () => {
    test("parses an unordered item", () => {
        expect(listItem("- hello")).toMatchObject({ ordered: false, bullet: "-", empty: false })
    })
    test("parses an ordered item and its delimiter", () => {
        expect(listItem("  3) go")).toMatchObject({ ordered: true, number: 3, delimiter: ")", indent: "  " })
    })
    test("flags an empty item", () => {
        expect(listItem("- ")).toMatchObject({ empty: true })
        expect(listItem("2. ")).toMatchObject({ empty: true })
    })
    test("returns null for a plain line", () => {
        expect(listItem("not a list")).toBeNull()
    })
})

describe("nextListPrefix", () => {
    test("repeats an unordered bullet with its indent", () => {
        expect(nextListPrefix(listItem("  * item")!)).toBe("  * ")
    })
    test("increments an ordered number", () => {
        expect(nextListPrefix(listItem("3. item")!)).toBe("4. ")
    })
})
