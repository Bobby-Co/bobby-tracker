import { describe, expect, it } from "bun:test"
import {
    draftIsEmpty,
    draftSummary,
    EMPTY_DRAFT_FIELDS,
    parseDraftStore,
    type DraftFields,
} from "./IssueDraft"

const fields = (patch: Partial<DraftFields> = {}): DraftFields => ({ ...EMPTY_DRAFT_FIELDS, ...patch })

describe("draftIsEmpty", () => {
    it("is empty when nothing was written", () => {
        expect(draftIsEmpty(EMPTY_DRAFT_FIELDS)).toBe(true)
    })

    it("is empty when only whitespace was typed", () => {
        expect(draftIsEmpty(fields({ title: "   ", body: "\n\t " }))).toBe(true)
    })

    it("is kept once there is a title, body, or labels", () => {
        expect(draftIsEmpty(fields({ title: "Login loops" }))).toBe(false)
        expect(draftIsEmpty(fields({ body: "steps to repro" }))).toBe(false)
        expect(draftIsEmpty(fields({ labels: "bug" }))).toBe(false)
    })

    it("does NOT keep a draft for status/priority/effort alone — nothing to return to", () => {
        expect(draftIsEmpty(fields({ status: "closed", priority: "urgent", effort: "high" }))).toBe(true)
    })
})

describe("draftSummary", () => {
    it("prefers the title", () => {
        expect(draftSummary(fields({ title: "  Crash on save  ", body: "anything" }))).toBe("Crash on save")
    })

    it("falls back to the first non-blank body line, stripped of heading marks", () => {
        expect(draftSummary(fields({ body: "\n\n## The bug\nmore" }))).toBe("The bug")
    })

    it("uses a placeholder when there is nothing to name it by", () => {
        expect(draftSummary(EMPTY_DRAFT_FIELDS)).toBe("Untitled draft")
    })
})

describe("parseDraftStore", () => {
    it("returns an empty store for null / malformed / non-object JSON", () => {
        expect(parseDraftStore(null)).toEqual({})
        expect(parseDraftStore("not json")).toEqual({})
        expect(parseDraftStore("[1,2,3]")).toEqual({})
        expect(parseDraftStore("42")).toEqual({})
    })

    it("keeps only array-valued project buckets", () => {
        const raw = JSON.stringify({ p1: [{ id: "d1" }], p2: "oops", p3: [{ id: "d2" }] })
        expect(parseDraftStore(raw)).toEqual({ p1: [{ id: "d1" }], p3: [{ id: "d2" }] } as never)
    })
})
