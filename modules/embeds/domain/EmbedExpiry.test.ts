import { test, expect, describe } from "bun:test"
import { EMBED_EXP_BUCKET_SECONDS, EMBED_MAX_TTL_SECONDS, embedExpiry } from "./EmbedExpiry"

const BUCKET = EMBED_EXP_BUCKET_SECONDS

describe("embedExpiry", () => {
    test("matches the contract's §7 worked example", () => {
        expect(embedExpiry(1800000000)).toBe(1800001800)
    })

    test("is constant across a bucket — the property that makes URLs cacheable", () => {
        const base = 1800000000
        const exp = embedExpiry(base)
        expect(embedExpiry(base + 1)).toBe(exp)
        expect(embedExpiry(base + BUCKET - 1)).toBe(exp)
        expect(embedExpiry(base + BUCKET)).toBe(exp + BUCKET)
    })

    test("never hands out a nearly-expired URL — that is what the +2 buys", () => {
        // The failure this guards: `ceil(now/BUCKET)*BUCKET` gives a viewer one
        // second of validity if they load the page one second before a boundary.
        for (let offset = 0; offset < BUCKET; offset++) {
            const now = 1800000000 + offset
            const ttl = embedExpiry(now) - now
            expect(ttl).toBeGreaterThanOrEqual(BUCKET)
            expect(ttl).toBeLessThanOrEqual(2 * BUCKET)
        }
    })

    test("stays inside Zoo's hard ceiling for every instant in a bucket", () => {
        for (let offset = 0; offset < BUCKET; offset++) {
            const now = 1800000000 + offset
            expect(embedExpiry(now) - now).toBeLessThanOrEqual(EMBED_MAX_TTL_SECONDS)
        }
    })

    test("is always in the future", () => {
        const now = 1800000000
        expect(embedExpiry(now)).toBeGreaterThan(now)
        expect(embedExpiry(now + BUCKET - 1)).toBeGreaterThan(now + BUCKET - 1)
    })
})
