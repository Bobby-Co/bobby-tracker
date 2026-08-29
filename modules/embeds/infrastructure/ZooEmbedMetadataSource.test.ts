// The status table from the upstream contract §6, as behaviour.
//
// The distinction that matters here is between "gone" and "we couldn't tell".
// 404 and 410 are Zoo's answers and become placeholders; a 403, a timeout or a
// DNS failure are OUR problem and must not turn a perfectly good embed into
// "removed" on the page.

import { test, expect, describe, beforeEach, afterEach } from "bun:test"
import type { Clock } from "@/lib/shared/kernel"
import { ZooEmbedMetadataSource } from "./ZooEmbedMetadataSource"
import type { EmbedFormat, EmbedUrlSigner } from "../ports/EmbedUrlSigner"

class FakeSigner implements EmbedUrlSigner {
    readonly kid = "issues-prod-1"
    async sign(embedId: string, format: EmbedFormat = "webp"): Promise<string> {
        return `https://zoo.example/e/${embedId}.${format}?kid=${this.kid}&exp=1800001800&sig=SIG`
    }
}

class MutableClock implements Clock {
    constructor(private ms = 1_800_000_000_000) {}
    now(): Date {
        return new Date(this.ms)
    }
    isoNow(): string {
        return this.now().toISOString()
    }
    advance(ms: number): void {
        this.ms += ms
    }
}

const realFetch = globalThis.fetch
let calls: string[] = []

/** Replaces fetch with a scripted responder; records every URL requested. */
function stubFetch(responder: (url: string) => Response | Promise<Response> | never) {
    calls = []
    globalThis.fetch = (async (input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
        calls.push(url)
        return responder(url)
    }) as typeof fetch
}

const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })

beforeEach(() => {
    calls = []
})
afterEach(() => {
    globalThis.fetch = realFetch
})

const source = (clock = new MutableClock()) => new ZooEmbedMetadataSource(new FakeSigner(), clock)

describe("ZooEmbedMetadataSource", () => {
    test("asks for the SIGNED .json — metadata is behind the same gate as the image", async () => {
        stubFetch(() => json({ embedId: "abc", componentId: "c1", w: 320, h: 200, contentType: "image/webp" }))
        await source().describe("abc")
        expect(calls[0]).toBe("https://zoo.example/e/abc.json?kid=issues-prod-1&exp=1800001800&sig=SIG")
    })

    test("reads dimensions out of a 200", async () => {
        stubFetch(() => json({ embedId: "abc", componentId: "c1", w: 320, h: 200, contentType: "image/webp" }))
        expect(await source().describe("abc")).toEqual({
            state: "ok",
            metadata: { componentId: "c1", w: 320, h: 200, contentType: "image/webp" },
        })
    })

    test("404 is missing, 410 is revoked", async () => {
        stubFetch((url) => json({ error: "gone" }, url.includes("dead") ? 404 : 410))
        expect(await source().describe("dead")).toEqual({ state: "missing" })
        expect(await source().describe("revoked")).toEqual({ state: "revoked" })
    })

    test("403 does NOT mean gone — a signing or clock problem must not blank the image", async () => {
        // Our bug, not Zoo's verdict on the embed. The image request will hit the
        // same 403 and the <img> will fall back on its own; claiming "removed"
        // here would be a lie the viewer can't correct.
        stubFetch(() => json({ error: "forbidden", reason: "expired" }, 403))
        expect(await source().describe("abc")).toEqual({ state: "ok", metadata: null })
    })

    test("an unreachable Zoo degrades the layout, never the image", async () => {
        stubFetch(() => {
            throw new Error("ECONNREFUSED")
        })
        expect(await source().describe("abc")).toEqual({ state: "ok", metadata: null })
    })

    test("malformed json is the same as no metadata", async () => {
        stubFetch(() => new Response("<html>nope</html>", { status: 200 }))
        expect(await source().describe("abc")).toEqual({ state: "ok", metadata: null })
    })

    test("ignores nonsense dimensions rather than writing them onto the img", async () => {
        stubFetch(() => json({ w: -5, h: "200", componentId: 7 }))
        expect(await source().describe("abc")).toEqual({
            state: "ok",
            metadata: { componentId: null, w: null, h: null, contentType: null },
        })
    })

    test("caches — embeds are immutable, so one render pays and the rest don't", async () => {
        stubFetch(() => json({ w: 10, h: 20 }))
        const s = source()
        await s.describe("abc")
        await s.describe("abc")
        await s.describe("abc")
        expect(calls).toHaveLength(1)
    })

    test("but re-checks after the TTL, so a revocation is noticed in minutes", async () => {
        const clock = new MutableClock()
        const s = source(clock)
        stubFetch(() => json({ w: 10, h: 20 }))
        await s.describe("abc")

        clock.advance(9 * 60 * 1000)
        await s.describe("abc")
        expect(calls).toHaveLength(1)

        clock.advance(2 * 60 * 1000)
        stubFetch(() => json({ error: "gone" }, 410))
        expect(await s.describe("abc")).toEqual({ state: "revoked" })
    })

    test("a failure is cached only briefly — an outage must not pin an embed as sizeless", async () => {
        const clock = new MutableClock()
        const s = source(clock)
        stubFetch(() => {
            throw new Error("down")
        })
        await s.describe("abc")

        clock.advance(31 * 1000)
        stubFetch(() => json({ w: 10, h: 20 }))
        expect(await s.describe("abc")).toEqual({
            state: "ok",
            metadata: { componentId: null, w: 10, h: 20, contentType: null },
        })
    })

    test("the cache is bounded — a long-lived isolate cannot grow one forever", async () => {
        stubFetch(() => json({ w: 1, h: 1 }))
        const s = source()
        for (let i = 0; i < 600; i++) await s.describe(`id${i}`)
        const after = calls.length

        // The oldest entries were evicted, so they cost a fetch again; the newest
        // are still resident and cost nothing.
        await s.describe("id0")
        await s.describe("id599")
        expect(calls.length).toBe(after + 1)
    })
})
