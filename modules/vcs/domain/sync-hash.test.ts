import { test, expect, describe } from "bun:test"
import { syncHash } from "./sync-hash"

// syncHash: the echo-suppression fingerprint. Correctness of the whole sync loop
// rests on ONE property: both sides must compute the identical hash for equivalent
// content, so our own outbound write echoing back as a webhook hashes to
// last_synced_hash and gets dropped. If the normalization ever drifts, the guard
// silently fails → infinite sync loop. Each test pins one rule the guard relies on.
//
// (The status↔state + direction rules that used to live beside this now belong to
// the Issue / Project aggregates and are covered by their own domain tests.)

describe("syncHash — shape + determinism", () => {
    test("is a 64-char lowercase hex SHA-256 digest", async () => {
        expect(await syncHash("Title", "Body", "open")).toMatch(/^[0-9a-f]{64}$/)
    })
    test("same inputs → same hash (deterministic across calls)", async () => {
        expect(await syncHash("T", "B", "closed")).toBe(await syncHash("T", "B", "closed"))
    })
})

describe("syncHash — normalization the echo-guard relies on", () => {
    test("title is trimmed (surrounding whitespace ignored)", async () => {
        expect(await syncHash("  Title  ", "B", "open")).toBe(await syncHash("Title", "B", "open"))
    })
    test("body CRLF is normalized to LF (a Windows echo hashes equal to a Unix one)", async () => {
        expect(await syncHash("T", "line1\r\nline2", "open")).toBe(await syncHash("T", "line1\nline2", "open"))
    })
    test("body is trimmed", async () => {
        expect(await syncHash("T", "\n Body \n", "open")).toBe(await syncHash("T", "Body", "open"))
    })
    test("state is case-insensitive", async () => {
        expect(await syncHash("T", "B", "OPEN" as "open")).toBe(await syncHash("T", "B", "open"))
    })
})

describe("syncHash — distinctness (a real change must NOT hash equal)", () => {
    test("open vs closed differ", async () => {
        expect(await syncHash("T", "B", "open")).not.toBe(await syncHash("T", "B", "closed"))
    })
    test("different title differs", async () => {
        expect(await syncHash("A", "B", "open")).not.toBe(await syncHash("Z", "B", "open"))
    })
    test("different body differs", async () => {
        expect(await syncHash("T", "one", "open")).not.toBe(await syncHash("T", "two", "open"))
    })
})
