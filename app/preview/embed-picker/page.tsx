"use client"

import { useEffect, useState } from "react"
import { EmbedPicker } from "@/components/embeds/embed-picker"
import { MarkdownBody } from "@/components/markdown/markdown-body"
import { insertEmbedReference } from "@/modules/embeds/domain/EmbedInsertion"
import type { SignedEmbed, SignedEmbedMap } from "@/modules/embeds/domain/SignedEmbed"
import type { ZooComponent } from "@/modules/embeds/domain/ZooComponent"

// The Zoo embed picker and the body it writes into, every state, no network.
//
// It exists because the real thing needs a running Zoo daemon and a claimed
// project to look at: picking a component MINTS one, which drives a headless
// browser on a developer's machine. This stubs window.fetch the same way the
// branch-index harness does, and stands in for Zoo's renders with inline SVG
// data URIs — TRANSPARENT on purpose, since coping with that is exactly what
// the surface behind an embed is for (upstream contract §8).

/** A transparent stand-in for a Zoo render, at a believable component size. */
function fakeRender(label: string, w: number, h: number, fill: string): string {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
        <rect x="6" y="6" width="${w - 12}" height="${h - 12}" rx="10" fill="${fill}"/>
        <text x="50%" y="52%" text-anchor="middle" font-family="ui-sans-serif,system-ui" font-size="15"
              font-weight="700" fill="#ffffff">${label}</text>
    </svg>`
    // No query string: a data: URI has no query, and appending one makes the SVG
    // unparseable — which is how the first run of this harness rendered four
    // blank thumbnails.
    return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}

interface Fixture {
    component: ZooComponent
    embed: SignedEmbed
}

function fixture(
    componentId: string,
    description: string,
    embedId: string,
    w: number,
    h: number,
    fill: string,
): Fixture {
    return {
        component: {
            id: componentId,
            name: componentId,
            description,
            file: `src/components/${componentId}.tsx`,
        },
        embed: {
            embedId,
            componentId,
            src: fakeRender(componentId, w, h, fill),
            w,
            h,
            state: "ok",
        },
    }
}

const FIXTURES: Fixture[] = [
    fixture("LoginButton", "The primary sign-in action.", "Zm9vYmFyMTIzNDU2Nzg5", 240, 96, "#4f46e5"),
    fixture("PricingCard", "Paid tier card with features.", "YmF6cXV4OTg3NjU0MzIx", 300, 180, "#0f766e"),
    fixture("ToastError", "One-line error toast.", "cXV1eDU1NTU1NTU1NTU1", 320, 88, "#b91c1c"),
    fixture("NavBarCollapsed", "", "d2FsZG84ODg4ODg4ODg4", 340, 72, "#7c3aed"),
]

const SETS = {
    "Components in this project": FIXTURES,
    "No components in Zoo": [] as Fixture[],
} as const

function json(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })
}

export default function EmbedPickerPreview() {
    const [set, setSet] = useState<keyof typeof SETS>("Components in this project")
    const [configured, setConfigured] = useState(true)
    const [online, setOnline] = useState(true)
    const [body, setBody] = useState("The regression shows up on the hover state:\n")
    const [inserted, setInserted] = useState<SignedEmbedMap>({})

    useEffect(() => {
        const real = window.fetch
        window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
            const url = typeof input === "string" ? input : input.toString()
            // Thumbnails first: the path also contains "/embeds", and the
            // picker asks for these before anything else.
            if (url.includes("/embeds/thumb")) {
                const id = new URL(url, window.location.origin).searchParams.get("componentId")
                const hit = FIXTURES.find((f) => f.component.id === id)
                // NavBarCollapsed has none on purpose — the row must degrade to
                // its name rather than leave a hole.
                if (!hit || id === "NavBarCollapsed") return new Response(null, { status: 404 })
                const svg = decodeURIComponent(String(hit.embed.src).split(",")[1])
                return new Response(svg, { status: 200, headers: { "Content-Type": "image/svg+xml" } })
            }
            if (url.includes("/embeds")) {
                // POST = mint. Slowed on purpose: a real mint drives a headless
                // browser, and the "rendering…" state is the part worth seeing.
                if (init?.method === "POST") {
                    const componentId = JSON.parse(String(init.body ?? "{}")).componentId as string
                    await new Promise((r) => setTimeout(r, 900))
                    const hit = FIXTURES.find((f) => f.component.id === componentId)
                    if (!hit) return json({ error: { message: "Zoo couldn't render that component." } }, 502)
                    return json({ embed: hit.embed }, 201)
                }
                return json({
                    configured,
                    online,
                    project: "external-app",
                    components: configured ? SETS[set].map((f) => f.component) : [],
                })
            }
            return real(input, init)
        }
        return () => {
            window.fetch = real
        }
    }, [set, configured, online])

    function onInsert(embed: SignedEmbed) {
        // The SAME insertion the editor uses — a harness that reimplements the
        // thing it verifies proves nothing (this one got the blank line wrong on
        // its first run, and the embed rendered mid-sentence).
        setBody((b) =>
            insertEmbedReference(b, b.length, b.length, embed.embedId, embed.componentId ?? "Component").text,
        )
        setInserted((m) => ({ ...m, [embed.embedId]: embed }))
    }

    return (
        <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-5 px-6 py-10">
            <header className="flex flex-col gap-1">
                <h1 className="text-[20px] font-extrabold tracking-[-0.012em]">Zoo embed picker</h1>
                <p className="text-[12.5px] text-[color:var(--c-text-muted)]">
                    Stubbed transport. Renders are transparent SVGs standing in for Zoo&apos;s.
                </p>
            </header>

            <div className="flex flex-wrap items-center gap-2">
                {(Object.keys(SETS) as (keyof typeof SETS)[]).map((k) => (
                    <Toggle key={k} on={set === k} onClick={() => setSet(k)}>
                        {k}
                    </Toggle>
                ))}
                <Toggle on={configured} onClick={() => setConfigured((c) => !c)}>
                    {configured ? "Zoo configured" : "Zoo NOT configured"}
                </Toggle>
                <Toggle on={online} onClick={() => setOnline((o) => !o)}>
                    {online ? "daemon online" : "daemon OFFLINE"}
                </Toggle>
            </div>

            <section className="rounded-[16px] border border-[color:var(--c-border)] bg-[color:var(--c-surface)] p-4 shadow-[var(--shadow-card)]">
                <div className="mb-2 h-section">Description</div>
                <div className="flex flex-col gap-2">
                    <div className="flex items-center">
                        <EmbedPicker
                            // Keyed so a toggle remounts: the picker loads its
                            // catalogue once per mount, which is right in the app
                            // and inert in a harness.
                            key={`${set}:${configured}:${online}`}
                            projectId="preview"
                            onInsert={onInsert}
                        />
                    </div>
                    <textarea
                        value={body}
                        onChange={(e) => setBody(e.target.value)}
                        rows={8}
                        className="input text-[13px]"
                    />
                </div>
            </section>

            <section className="rounded-[16px] border border-[color:var(--c-border)] bg-[color:var(--c-surface)] p-4 shadow-[var(--shadow-card)]">
                <div className="mb-2 h-section">Rendered</div>
                <div className="prose-tracker text-[13px] leading-6 text-[color:var(--c-text)]">
                    <MarkdownBody embeds={inserted}>{body}</MarkdownBody>
                </div>
            </section>

            <section className="rounded-[16px] border border-[color:var(--c-border)] bg-[color:var(--c-surface)] p-4 shadow-[var(--shadow-card)]">
                <div className="mb-2 h-section">Unresolvable states</div>
                <div className="prose-tracker text-[13px] leading-6 text-[color:var(--c-text)]">
                    <MarkdownBody
                        embeds={{
                            Gone1: { embedId: "Gone1", componentId: null, src: null, w: null, h: null, state: "revoked" },
                            Miss1: { embedId: "Miss1", componentId: null, src: null, w: null, h: null, state: "missing" },
                        }}
                    >
                        {"Revoked: ![Old modal](zoo:Gone1)\n\nMissing: ![Deleted card](zoo:Miss1)\n\nUnsigned surface: ![Hover state](zoo:NeverSigned)\n"}
                    </MarkdownBody>
                </div>
            </section>
        </main>
    )
}

function Toggle({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
    return (
        <button
            onClick={onClick}
            className={
                "rounded-md px-2.5 py-1 text-[11.5px] font-semibold " +
                (on
                    ? "bg-[color:var(--c-text)] text-[color:var(--c-surface)]"
                    : "bg-[color:var(--c-surface-2)] text-[color:var(--c-text-muted)]")
            }
        >
            {children}
        </button>
    )
}
