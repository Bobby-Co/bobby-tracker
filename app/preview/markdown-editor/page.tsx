"use client"

import { useEffect, useState } from "react"
import { MarkdownEditor } from "@/components/markdown/markdown-editor"
import { MarkdownBody } from "@/components/markdown/markdown-body"
import type { SignedEmbed, SignedEmbedMap } from "@/modules/embeds/domain/SignedEmbed"
import type { ZooComponent } from "@/modules/embeds/domain/ZooComponent"

// The block live-preview markdown editor, wired to a stubbed Zoo transport.
//
// The point of the harness is to exercise the parts that need no server and are
// easy to break: block splitting on Enter, click-to-edit, the tools strip and
// right-click menu, and an embed arriving as its own rendered block. The Zoo
// endpoints are stubbed the same way app/preview/embed-picker does, so "Add
// component" mints a (transparent) render without a daemon.

function fakeRender(label: string, w: number, h: number, fill: string): string {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
        <rect x="6" y="6" width="${w - 12}" height="${h - 12}" rx="10" fill="${fill}"/>
        <text x="50%" y="52%" text-anchor="middle" font-family="ui-sans-serif,system-ui" font-size="15"
              font-weight="700" fill="#ffffff">${label}</text>
    </svg>`
    return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}

interface Fixture {
    component: ZooComponent
    embed: SignedEmbed
}

const FIXTURES: Fixture[] = [
    {
        component: { id: "LoginButton", name: "LoginButton", description: "The primary sign-in action.", file: "src/components/LoginButton.tsx" },
        embed: { embedId: "Zm9vYmFyMTIzNDU2Nzg5", componentId: "LoginButton", src: fakeRender("LoginButton", 240, 96, "#4f46e5"), w: 240, h: 96, state: "ok" },
    },
    {
        component: { id: "PricingCard", name: "PricingCard", description: "Paid tier card.", file: "src/components/PricingCard.tsx" },
        embed: { embedId: "YmF6cXV4OTg3NjU0MzIx", componentId: "PricingCard", src: fakeRender("PricingCard", 300, 180, "#0f766e"), w: 300, h: 180, state: "ok" },
    },
]

function json(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })
}

const INITIAL = `# Login is broken

Steps to **reproduce** the regression:

- Open the app in a private window
- Click the sign-in button

The hover state is where it shows up. Click any block above to edit it, or press Enter to render the block you're on.`

export default function MarkdownEditorPreview() {
    const [body, setBody] = useState(INITIAL)
    const [embeds, setEmbeds] = useState<SignedEmbedMap>({})

    useEffect(() => {
        const real = window.fetch
        window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
            const url = typeof input === "string" ? input : input.toString()
            if (url.includes("/embeds/thumb")) {
                const id = new URL(url, window.location.origin).searchParams.get("componentId")
                const hit = FIXTURES.find((f) => f.component.id === id)
                if (!hit) return new Response(null, { status: 404 })
                const svg = decodeURIComponent(String(hit.embed.src).split(",")[1])
                return new Response(svg, { status: 200, headers: { "Content-Type": "image/svg+xml" } })
            }
            if (url.includes("/embeds")) {
                if (init?.method === "POST") {
                    const componentId = JSON.parse(String(init.body ?? "{}")).componentId as string
                    await new Promise((r) => setTimeout(r, 700))
                    const hit = FIXTURES.find((f) => f.component.id === componentId)
                    if (!hit) return json({ error: { message: "Zoo couldn't render that." } }, 502)
                    return json({ embed: hit.embed }, 201)
                }
                return json({ configured: true, online: true, project: "preview", components: FIXTURES.map((f) => f.component) })
            }
            return real(input, init)
        }
        return () => {
            window.fetch = real
        }
    }, [])

    return (
        <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-5 px-6 py-10">
            <header className="flex flex-col gap-1">
                <h1 className="text-[20px] font-extrabold tracking-[-0.012em]">Markdown editor</h1>
                <p className="text-[12.5px] text-[color:var(--c-text-muted)]">
                    Block live preview. Stubbed Zoo transport — &ldquo;Add component&rdquo; mints a transparent render.
                </p>
            </header>

            <section className="rounded-[16px] border border-[color:var(--c-border)] bg-[color:var(--c-surface)] p-4 shadow-[var(--shadow-card)]">
                <div className="mb-2 h-section">Description</div>
                <MarkdownEditor
                    value={body}
                    onChange={setBody}
                    projectId="preview"
                    embeds={embeds}
                    onEmbedInserted={(e) => setEmbeds((m) => ({ ...m, [e.embedId]: e }))}
                    ariaLabel="Issue description"
                />
            </section>

            <section className="rounded-[16px] border border-[color:var(--c-border)] bg-[color:var(--c-surface)] p-4 shadow-[var(--shadow-card)]">
                <div className="mb-2 h-section">Rendered (what gets saved)</div>
                <div className="prose-tracker text-[13px] leading-6 text-[color:var(--c-text)]">
                    <MarkdownBody embeds={embeds}>{body}</MarkdownBody>
                </div>
            </section>

            <section className="rounded-[16px] border border-[color:var(--c-border)] bg-[color:var(--c-surface)] p-4 shadow-[var(--shadow-card)]">
                <div className="mb-2 h-section">Emitted markdown</div>
                <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded-[10px] bg-[color:var(--c-surface-2)] p-3 font-mono text-[11.5px] leading-5 text-[color:var(--c-text-muted)]">
                    {body || "(empty)"}
                </pre>
            </section>
        </main>
    )
}
