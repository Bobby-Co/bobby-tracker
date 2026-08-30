import { test, expect, describe } from "bun:test"
import {
    bold,
    italic,
    inlineCode,
    cycleHeading,
    toggleQuote,
    toggleBulletList,
    insertLink,
    insertAtCaret,
    type Selection,
} from "./MarkdownFormatting"

/** Build a selection from a string with `|` marking the caret, or `[` `]`
 *  marking a range. Keeps the tests readable. */
function sel(spec: string): Selection {
    if (spec.includes("[")) {
        const start = spec.indexOf("[")
        const end = spec.indexOf("]") - 1
        return { text: spec.replace(/[[\]]/g, ""), start, end }
    }
    const start = spec.indexOf("|")
    return { text: spec.replace(/\|/g, ""), start, end: start }
}

describe("bold", () => {
    test("wraps a selection", () => {
        const r = bold(sel("say [hello] there"))
        expect(r.text).toBe("say **hello** there")
        expect(r.text.slice(r.start, r.end)).toBe("hello")
    })
    test("unwraps when already bold (markers outside selection)", () => {
        const r = bold({ text: "say **hello** there", start: 6, end: 11 })
        expect(r.text).toBe("say hello there")
    })
    test("inserts an empty pair with the caret between", () => {
        const r = bold(sel("a |b"))
        expect(r.text).toBe("a ****b")
        expect(r.start).toBe(4)
        expect(r.end).toBe(4)
    })
})

describe("italic / inline code", () => {
    test("italic wraps", () => {
        expect(italic(sel("[hi]")).text).toBe("*hi*")
    })
    test("inline code wraps", () => {
        expect(inlineCode(sel("[x]")).text).toBe("`x`")
    })
})

describe("cycleHeading", () => {
    test("plain → h1 → h2 → h3 → plain", () => {
        let s: Selection = sel("|Title")
        s = cycleHeading(s)
        expect(s.text).toBe("# Title")
        s = cycleHeading(s)
        expect(s.text).toBe("## Title")
        s = cycleHeading(s)
        expect(s.text).toBe("### Title")
        s = cycleHeading(s)
        expect(s.text).toBe("Title")
    })
    test("only touches the caret's line", () => {
        const r = cycleHeading({ text: "a\nb\nc", start: 2, end: 2 })
        expect(r.text).toBe("a\n# b\nc")
    })
})

describe("toggleQuote / toggleBulletList", () => {
    test("adds and removes a quote across selected lines", () => {
        const range: Selection = { text: "one\ntwo", start: 0, end: 7 }
        const quoted = toggleQuote(range)
        expect(quoted.text).toBe("> one\n> two")
        const unquoted = toggleQuote({ ...quoted, start: 0, end: quoted.text.length })
        expect(unquoted.text).toBe("one\ntwo")
    })
    test("bullets a single line", () => {
        expect(toggleBulletList(sel("|item")).text).toBe("- item")
    })
})

describe("insertLink", () => {
    test("wraps a selection and selects the url slot", () => {
        const r = insertLink(sel("see [docs] now"))
        expect(r.text).toBe("see [docs](url) now")
        expect(r.text.slice(r.start, r.end)).toBe("url")
    })
    test("empty selection drops a skeleton with caret in the text slot", () => {
        const r = insertLink(sel("|"))
        expect(r.text).toBe("[](url)")
        expect(r.start).toBe(1)
    })
})

describe("insertAtCaret", () => {
    test("replaces the selection", () => {
        const r = insertAtCaret(sel("a[XX]b"), "Y")
        expect(r.text).toBe("aYb")
    })
    test("inserts at a caret", () => {
        const r = insertAtCaret(sel("a|b"), "X")
        expect(r.text).toBe("aXb")
        expect(r.start).toBe(2)
    })
})
