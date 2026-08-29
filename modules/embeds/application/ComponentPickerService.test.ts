// Consent is the part worth testing here: the picker's job is to turn Zoo's
// answers into something an author can act on, and "not connected" versus
// "unreachable" versus "renders nothing" send them to fix different things.

import { test, expect, describe } from "bun:test"
import { ComponentPickerService } from "./ComponentPickerService"
import { EmbedSigningService } from "./EmbedSigningService"
import type { CatalogueOutcome, ComponentCatalog, ComponentThumbnails, ThumbnailResult } from "../ports/ComponentCatalog"
import type { EmbedMinter, MintResult } from "../ports/EmbedMinter"
import type { EmbedDescription, EmbedMetadataSource } from "../ports/EmbedMetadataSource"
import type { EmbedFormat, EmbedUrlSigner } from "../ports/EmbedUrlSigner"

class FakeSigner implements EmbedUrlSigner {
    readonly kid = "issues-prod-1"
    async sign(embedId: string, format: EmbedFormat = "webp"): Promise<string> {
        return `https://zoo.example/e/${embedId}.${format}?sig=SIG`
    }
}
class FakeMetadata implements EmbedMetadataSource {
    async describe(embedId: string): Promise<EmbedDescription> {
        return { state: "ok", metadata: { componentId: `C-${embedId}`, w: 10, h: 10, contentType: null } }
    }
}

/** Records the subject it was called with — the whole point of the tenant
 *  binding is that it reaches Zoo, so a service that dropped it would be a
 *  silent authorization bug. */
class RecordingCatalog implements ComponentCatalog, ComponentThumbnails {
    subjects: string[] = []
    constructor(private readonly outcome: CatalogueOutcome) {}
    async forRepo(_repoUrl: string, subject: string): Promise<CatalogueOutcome> {
        this.subjects.push(subject)
        return this.outcome
    }
    async thumbnail(_r: string, _c: string, subject: string): Promise<ThumbnailResult> {
        this.subjects.push(subject)
        return { status: "unavailable" }
    }
}

class FakeMinter implements EmbedMinter {
    subjects: string[] = []
    constructor(private readonly result: MintResult) {}
    async mint(input: { repoUrl: string; componentId: string; subject: string }): Promise<MintResult> {
        this.subjects.push(input.subject)
        return this.result
    }
}

const service = (catalogue: CatalogueOutcome, mint: MintResult) => {
    const catalog = new RecordingCatalog(catalogue)
    const minter = new FakeMinter(mint)
    const signing = new EmbedSigningService(new FakeSigner(), new FakeMetadata())
    return { svc: new ComponentPickerService(catalog, minter, signing, catalog), catalog, minter }
}

const OK: CatalogueOutcome = {
    status: "ok",
    catalogue: { repo: "github.com/acme/app", project: "app", online: true, components: [] },
}

describe("ComponentPickerService — consent reaches Zoo", () => {
    test("the subject is passed through to the catalogue", async () => {
        const { svc, catalog } = service(OK, { ok: false, reason: "error" })
        await svc.list("git@github.com:acme/app.git", "project-42")
        expect(catalog.subjects).toEqual(["project-42"])
    })

    test("and to thumbnails, and to minting", async () => {
        const { svc, catalog, minter } = service(OK, { ok: false, reason: "error" })
        await svc.thumbnail("git@github.com:acme/app.git", "Card", "project-42")
        await svc.pick({ repoUrl: "git@github.com:acme/app.git", componentId: "Card", subject: "project-42" })
        expect(catalog.subjects).toEqual(["project-42"])
        expect(minter.subjects).toEqual(["project-42"])
    })
})

describe("ComponentPickerService — Zoo's answers stay distinguishable", () => {
    test("not-connected is not flattened into unavailable", async () => {
        const { svc } = service({ status: "not-connected" }, { ok: false, reason: "error" })
        expect((await svc.list("git@github.com:acme/app.git", "p")).status).toBe("not-connected")
    })

    test("unavailable stays unavailable", async () => {
        const { svc } = service({ status: "unavailable" }, { ok: false, reason: "error" })
        expect((await svc.list("git@github.com:acme/app.git", "p")).status).toBe("unavailable")
    })

    test("a mint refused for consent keeps its reason", async () => {
        for (const reason of ["not-granted", "scope-not-granted"] as const) {
            const { svc } = service(OK, { ok: false, reason })
            const r = await svc.pick({ repoUrl: "git@github.com:acme/app.git", componentId: "Card", subject: "p" })
            expect(r).toEqual({ ok: false, reason })
        }
    })

    test("a successful mint comes back signed and renderable", async () => {
        const { svc } = service(OK, { ok: true, embedId: "abc", componentId: "Card", w: 10, h: 10 })
        const r = await svc.pick({ repoUrl: "git@github.com:acme/app.git", componentId: "Card", subject: "p" })
        expect(r.ok).toBe(true)
        if (r.ok) {
            expect(r.embed.embedId).toBe("abc")
            expect(r.embed.src).toContain("/e/abc.webp")
        }
    })
})
