"use client"

import { useEffect } from "react"
import { AuthProvider } from "@/lib/client/auth/auth-context"
import { TeamProvider } from "@/lib/client/auth/team-context"
import { Sidebar } from "@/components/layout/sidebar"
import {
    IssueComposerProvider,
    IssueComposerPanel,
    useIssueComposer,
} from "@/components/issues/issue-composer"
import { IssueList, type ParentRow } from "@/components/issues/issue-list"
import type { Issue, Project } from "@/lib/shared/types"
import type { ZooComponent } from "@/modules/embeds/domain/ZooComponent"
import type { SignedEmbed } from "@/modules/embeds/domain/SignedEmbed"

// The docked New Issue composer + the push/collapse shell mechanics.
//
// Wraps the REAL Auth/Team providers (stubbed network) so it can render the REAL
// Sidebar morphing to a rail as the composer opens, and the REAL
// IssueComposerPanel pushing the content. It verifies the three things this
// change is about: the panel pushes the content instead of covering it, the
// left sidebar MORPHS to icons while composing, and the panel resizes. Without a
// session the team switch + balance show skeletons; everything else is real.

const PROJECTS: Project[] = [
    { id: "preview", name: "Preview", team_id: "t", created_at: "", updated_at: "" },
    { id: "p2", name: "Analyser", team_id: "t", created_at: "", updated_at: "" },
] as unknown as Project[]

function issue(n: number, title: string, status: string): Issue {
    return { id: `iss-${n}`, project_id: "preview", issue_number: n, title, status, priority: "medium", labels: [] } as unknown as Issue
}
const PARENTS: ParentRow[] = [
    { parent: issue(101, "Login is broken on Safari", "open"), children: [] },
    { parent: issue(102, "Slow query on the dashboard", "in_progress"), children: [] },
    { parent: issue(103, "Flaky checkout test", "blocked"), children: [] },
]

function fakeRender(label: string, w: number, h: number, fill: string): string {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
        <rect x="6" y="6" width="${w - 12}" height="${h - 12}" rx="10" fill="${fill}"/>
        <text x="50%" y="52%" text-anchor="middle" font-family="ui-sans-serif" font-size="15" font-weight="700" fill="#fff">${label}</text>
    </svg>`
    return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}

const COMPONENTS: { c: ZooComponent; e: SignedEmbed }[] = [
    {
        c: { id: "LoginButton", name: "LoginButton", description: "Primary sign-in.", file: "src/LoginButton.tsx" },
        e: { embedId: "Zm9vYmFyMTIzNDU2Nzg5", componentId: "LoginButton", src: fakeRender("LoginButton", 240, 96, "#4f46e5"), w: 240, h: 96, state: "ok" },
    },
]

// Two ready branches + one still indexing, so the preview shows both what the
// picker offers and what it deliberately withholds.
const BRANCHES = [
    { id: "b1", project_id: "preview", branch: "development", status: "ready" },
    { id: "b2", project_id: "preview", branch: "feat/multi-branch", status: "ready" },
    { id: "b3", project_id: "preview", branch: "feat/half-done", status: "indexing" },
]

function json(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })
}

function useStubbedApi() {
    useEffect(() => {
        const real = window.fetch
        window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
            const url = typeof input === "string" ? input : input.toString()
            if (url.includes("/embeds/thumb")) {
                const svg = decodeURIComponent(String(COMPONENTS[0].e.src).split(",")[1])
                return new Response(svg, { status: 200, headers: { "Content-Type": "image/svg+xml" } })
            }
            if (url.includes("/embeds")) {
                if (init?.method === "POST") {
                    await new Promise((r) => setTimeout(r, 500))
                    return json({ embed: COMPONENTS[0].e }, 201)
                }
                return json({ configured: true, online: true, project: "preview", components: COMPONENTS.map((x) => x.c) })
            }
            if (url.includes("/api/issues") && init?.method === "POST") {
                // Don't actually navigate the harness away — report success without an id.
                return json({ issue: {} }, 201)
            }
            if (url.includes("/api/teams") && url.includes("/groups")) return json({ groups: [] })
            if (url.includes("/api/teams")) return json({ teams: [] })
            if (url.includes("/api/billing/balance")) return json({ balance: null })
            // Before the generic /api/projects catch-all, or it would swallow
            // this and the branch control would never render in the preview.
            if (url.includes("/branches")) return json({ branches: BRANCHES })
            if (url.includes("/api/projects")) return json({ projects: PROJECTS })
            return real(input, init)
        }
        return () => {
            window.fetch = real
        }
    }, [])
}

export default function IssueComposerPreview() {
    return (
        <AuthProvider>
            <TeamProvider>
                <IssueComposerProvider projectScope="preview">
                    <Shell />
                </IssueComposerProvider>
            </TeamProvider>
        </AuthProvider>
    )
}

function Shell() {
    useStubbedApi()
    const { expanded, startDraft } = useIssueComposer()
    const mode: "full" | "rail" = expanded ? "rail" : "full"

    return (
        <div className="flex h-screen w-full bg-[color:var(--c-shell)] text-[color:var(--c-text)]">
            <Sidebar projects={PROJECTS} mode={mode} />
            <div className="flex min-w-0 flex-1 flex-col pt-2">
                <header className="flex h-14 shrink-0 items-center gap-3 px-5">
                    <span className="text-[12.5px] font-semibold text-[color:var(--c-text-muted)]">Projects › Preview › Issues</span>
                    <div className="ml-auto flex items-center gap-3">
                        <span className="rounded-[10px] border border-[color:var(--c-border)] px-3 py-1.5 text-[12px] text-[color:var(--c-text-dim)]">Search…</span>
                        <span className="grid h-8 w-8 place-items-center rounded-full border border-[color:var(--c-border)] text-[color:var(--c-text-dim)]">🔔</span>
                        <NewIssueTrigger onClick={() => startDraft("preview")} />
                    </div>
                </header>
                <div className="flex min-h-0 flex-1">
                    <main className="min-w-0 flex-1">
                        <div className={"app-panel p-6" + (expanded ? " app-panel--tray" : "")}>
                            <div className="mb-4 flex items-center justify-between">
                                <h1 className="text-[20px] font-extrabold tracking-[-0.012em]">Issues</h1>
                                <NewIssueTrigger onClick={() => startDraft("preview")} />
                            </div>
                            <p className="mb-2 text-[12px] text-[color:var(--c-text-muted)]">Drag an issue into the composer to reference it.</p>
                            <IssueList projectId="preview" parents={PARENTS} />
                        </div>
                    </main>
                    <IssueComposerPanel />
                </div>
            </div>
        </div>
    )
}

function NewIssueTrigger({ onClick }: { onClick: () => void }) {
    return (
        <button onClick={onClick} className="btn-primary">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden>
                <path d="M12 5v14M5 12h14" />
            </svg>
            New issue
        </button>
    )
}

