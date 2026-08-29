// The upstream contract's §7 test vectors, reproduced byte for byte.
//
// This is the only test that can tell us our signer and Zoo's verifier agree:
// everything else in this module is our own reasoning about our own code. If
// this file goes red, no image will load in production and the reason will be
// a 403 with `reason: "bad-signature"`.
//
// The key below is the contract's published TEST key. It is public by
// construction and must never be used for anything.

import { test, expect, describe } from "bun:test"
import type { Clock } from "@/lib/shared/kernel"
import { ZooEmbedUrlSigner } from "./ZooEmbedUrlSigner"

const VECTOR = {
    privateSeedB64Url: "AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyA",
    publicKeyB64Url: "ebVWLo_mVPlAeLES6KmLp5AfhTrmlb7X4OORC60ElmQ",
    embedId: "Zm9vYmFyMTIzNDU2Nzg5",
    kid: "issues-prod-1",
    nowSec: 1800000000,
    exp: 1800001800,
    payload: "v1.Zm9vYmFyMTIzNDU2Nzg5.1800001800.issues-prod-1",
    sig: "5CRx2CfsgRMNa38pz6dDNhzrG2w0dRiuX3BK2jo2J88mjGCRcEk31px-3vOoyL5oZMsZ3kyPHROpeoSJ8H9DCw",
    path: "/e/Zm9vYmFyMTIzNDU2Nzg5.webp?kid=issues-prod-1&exp=1800001800&sig=5CRx2CfsgRMNa38pz6dDNhzrG2w0dRiuX3BK2jo2J88mjGCRcEk31px-3vOoyL5oZMsZ3kyPHROpeoSJ8H9DCw",
}

/** Time is an input to a signature, so it has to be one here too. */
function frozenClock(atSec: number): Clock {
    const at = new Date(atSec * 1000)
    return { now: () => at, isoNow: () => at.toISOString() }
}

const signer = (nowSec = VECTOR.nowSec) =>
    new ZooEmbedUrlSigner(
        { host: "https://zoo.example", kid: VECTOR.kid, privateSeedB64Url: VECTOR.privateSeedB64Url },
        frozenClock(nowSec),
    )

describe("ZooEmbedUrlSigner — contract §7 vectors", () => {
    test("reproduces the published signature and path exactly", async () => {
        const url = await signer().sign(VECTOR.embedId)
        expect(url).toBe(`https://zoo.example${VECTOR.path}`)
    })

    test("the signature verifies under the published PUBLIC key", async () => {
        // Proves we signed the canonical payload, not merely something stable:
        // a self-consistent bug would pass the vector comparison above only by
        // coincidence, but cannot pass verification against Zoo's side of the key.
        const sig = new URL(await signer().sign(VECTOR.embedId)).searchParams.get("sig")!
        const key = await crypto.subtle.importKey(
            "raw", base64UrlToBytes(VECTOR.publicKeyB64Url), { name: "Ed25519" }, false, ["verify"],
        )
        const verified = await crypto.subtle.verify(
            "Ed25519", key, base64UrlToBytes(sig), new TextEncoder().encode(VECTOR.payload),
        )
        expect(verified).toBe(true)
    })

    test("signs .json metadata with the same signature — the payload binds the id, not the extension", async () => {
        const image = new URL(await signer().sign(VECTOR.embedId, "webp"))
        const meta = new URL(await signer().sign(VECTOR.embedId, "json"))
        expect(meta.pathname).toBe(`/e/${VECTOR.embedId}.json`)
        expect(meta.searchParams.get("sig")).toBe(image.searchParams.get("sig"))
    })
})

describe("ZooEmbedUrlSigner — URL shape", () => {
    test("a bare host is normalised to https, and a trailing slash dropped", async () => {
        const url = await new ZooEmbedUrlSigner(
            { host: "zoo.example/", kid: VECTOR.kid, privateSeedB64Url: VECTOR.privateSeedB64Url },
            frozenClock(VECTOR.nowSec),
        ).sign(VECTOR.embedId)
        expect(url.startsWith("https://zoo.example/e/")).toBe(true)
    })

    test("every viewer inside one bucket gets a byte-identical URL — that is what lets it cache", async () => {
        const early = await signer(VECTOR.nowSec).sign(VECTOR.embedId)
        const late = await signer(VECTOR.nowSec + 899).sign(VECTOR.embedId)
        expect(late).toBe(early)
        expect(await signer(VECTOR.nowSec + 900).sign(VECTOR.embedId)).not.toBe(early)
    })

    test("rejects an embed id that would make the payload ambiguous", async () => {
        await expect(signer().sign("has.a.dot")).rejects.toThrow(/valid embed id/)
        await expect(signer().sign("has/a/slash")).rejects.toThrow(/valid embed id/)
    })

    test("rejects a seed that is not 32 bytes", async () => {
        const bad = new ZooEmbedUrlSigner(
            { host: "zoo.example", kid: VECTOR.kid, privateSeedB64Url: "AQID" },
            frozenClock(VECTOR.nowSec),
        )
        await expect(bad.sign(VECTOR.embedId)).rejects.toThrow(/32 bytes/)
    })

    test("rejects a kid that could not round-trip through the payload", () => {
        expect(
            () =>
                new ZooEmbedUrlSigner(
                    { host: "zoo.example", kid: "issues.prod.1", privateSeedB64Url: VECTOR.privateSeedB64Url },
                    frozenClock(VECTOR.nowSec),
                ),
        ).toThrow(/valid kid/)
    })
})

function base64UrlToBytes(value: string): Uint8Array {
    const base64 = value.replace(/-/g, "+").replace(/_/g, "/")
    const binary = atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4))
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    return bytes
}
