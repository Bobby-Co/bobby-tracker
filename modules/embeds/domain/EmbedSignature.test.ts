import { test, expect, describe } from "bun:test"
import { embedSigningPayload, isValidKid } from "./EmbedSignature"

describe("embedSigningPayload", () => {
    test("builds the contract's canonical payload", () => {
        expect(embedSigningPayload("Zm9vYmFyMTIzNDU2Nzg5", 1800001800, "issues-prod-1")).toBe(
            "v1.Zm9vYmFyMTIzNDU2Nzg5.1800001800.issues-prod-1",
        )
    })

    test("refuses a dotted embed id — joining on '.' would stop being reversible", () => {
        // Without this, `v1.a.b.1800001800.kid` could be read as a signature over
        // a different (embedId, exp, kid) triple.
        expect(() => embedSigningPayload("a.b", 1800001800, "issues-prod-1")).toThrow(/must not contain/)
    })

    test("refuses a dotted kid for the same reason", () => {
        expect(() => embedSigningPayload("abc", 1800001800, "issues.prod.1")).toThrow(/kid must match/)
    })

    test("refuses a non-integer or non-positive exp", () => {
        expect(() => embedSigningPayload("abc", 1800001800.5, "kid-1")).toThrow(/positive integer/)
        expect(() => embedSigningPayload("abc", 0, "kid-1")).toThrow(/positive integer/)
    })
})

describe("isValidKid", () => {
    test("accepts the contract's example shape", () => {
        expect(isValidKid("issues-prod-1")).toBe(true)
        expect(isValidKid("bobby_tracker_2")).toBe(true)
    })
    test("rejects dots, slashes, and empty", () => {
        expect(isValidKid("issues.prod")).toBe(false)
        expect(isValidKid("issues/prod")).toBe(false)
        expect(isValidKid("")).toBe(false)
    })
})
