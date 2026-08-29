import { test, expect, describe } from "bun:test"
import { EmbedSigningService } from "./EmbedSigningService"
import type { EmbedDescription, EmbedMetadataSource } from "../ports/EmbedMetadataSource"
import type { EmbedFormat, EmbedUrlSigner } from "../ports/EmbedUrlSigner"

class FakeSigner implements EmbedUrlSigner {
    readonly kid = "issues-prod-1"
    readonly signed: string[] = []
    async sign(embedId: string, format: EmbedFormat = "webp"): Promise<string> {
        this.signed.push(embedId)
        return `https://zoo.example/e/${embedId}.${format}?kid=${this.kid}&exp=1800001800&sig=SIG`
    }
}

class FakeMetadata implements EmbedMetadataSource {
    constructor(private readonly answers: Record<string, EmbedDescription>) {}
    async describe(embedId: string): Promise<EmbedDescription> {
        return this.answers[embedId] ?? { state: "ok", metadata: null }
    }
}

const sized = (w: number, h: number): EmbedDescription => ({
    state: "ok",
    metadata: { componentId: "c1", w, h, contentType: "image/webp" },
})

describe("EmbedSigningService", () => {
    test("signs the embeds a body references, and carries their dimensions", async () => {
        const signer = new FakeSigner()
        const service = new EmbedSigningService(signer, new FakeMetadata({ abc: sized(320, 200) }))

        const map = await service.forMarkdown("![Login](zoo:abc)")

        expect(map.abc.src).toContain("/e/abc.webp?")
        expect(map.abc).toMatchObject({ embedId: "abc", componentId: "c1", w: 320, h: 200, state: "ok" })
    })

    test("a body with no embeds does no work at all", async () => {
        const signer = new FakeSigner()
        expect(await new EmbedSigningService(signer).forMarkdown("just text")).toEqual({})
        expect(await new EmbedSigningService(signer).forMarkdown(null)).toEqual({})
        expect(signer.signed).toEqual([])
    })

    test("emits NO url for a revoked embed — a valid signature would still load it", async () => {
        // Revocation is not bound to signatures (contract §9): the only way the
        // viewer sees "removed" instead of a broken image is if we withhold the URL.
        const signer = new FakeSigner()
        const service = new EmbedSigningService(signer, new FakeMetadata({ gone: { state: "revoked" } }))

        const map = await service.forMarkdown("![x](zoo:gone)")

        expect(map.gone).toMatchObject({ src: null, state: "revoked" })
        expect(signer.signed).toEqual([])
    })

    test("emits no url for a missing embed either", async () => {
        const service = new EmbedSigningService(new FakeSigner(), new FakeMetadata({ nope: { state: "missing" } }))
        expect(await service.forMarkdown("![x](zoo:nope)")).toMatchObject({
            nope: { src: null, state: "missing" },
        })
    })

    test("still renders when metadata is unreachable — just without reserved space", async () => {
        const service = new EmbedSigningService(
            new FakeSigner(),
            new FakeMetadata({ abc: { state: "ok", metadata: null } }),
        )
        const map = await service.forMarkdown("![x](zoo:abc)")
        expect(map.abc.src).toBeTruthy()
        expect(map.abc).toMatchObject({ w: null, h: null, state: "ok" })
    })

    test("works with no metadata source at all", async () => {
        const map = await new EmbedSigningService(new FakeSigner()).forMarkdown("![x](zoo:abc)")
        expect(map.abc).toMatchObject({ w: null, h: null, state: "ok" })
        expect(map.abc.src).toBeTruthy()
    })

    test("skips ids that aren't well-formed rather than failing the page", async () => {
        const signer = new FakeSigner()
        expect(await new EmbedSigningService(signer).forIds(["ok1", "not a id", ""])).toEqual({
            ok1: {
                embedId: "ok1",
                componentId: null,
                src: "https://zoo.example/e/ok1.webp?kid=issues-prod-1&exp=1800001800&sig=SIG",
                w: null,
                h: null,
                state: "ok",
            },
        })
        expect(signer.signed).toEqual(["ok1"])
    })

    test("signs one embed once, however many times the body uses it", async () => {
        const signer = new FakeSigner()
        await new EmbedSigningService(signer).forMarkdown("![a](zoo:abc)\n![b](zoo:abc)\n![c](zoo:abc)")
        expect(signer.signed).toEqual(["abc"])
    })
})
