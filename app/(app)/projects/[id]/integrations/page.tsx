import Link from "next/link"
import { createClient } from "@/lib/supabase/server"
import type { PublicSession } from "@/lib/supabase/types"

export const dynamic = "force-dynamic"

// Integrations tab — external-service syncs (GitHub Issues, Linear,
// etc.) and a read-only summary of which public sessions cover this
// project. Session management itself lives at /sessions/[id].
export default async function IntegrationsPage({
    params,
}: {
    params: Promise<{ id: string }>
}) {
    const { id } = await params
    const supabase = await createClient()

    // Tolerate the new tables being absent (migration 0009 not yet applied).
    const { data: links, error: linkErr } = await supabase
        .from("public_session_projects")
        .select("session_id,public_sessions(id,name,enabled,submission_count)")
        .eq("project_id", id)
    const tableMissing = !!linkErr

    type Row = { session_id: string; public_sessions: Pick<PublicSession, "id" | "name" | "enabled" | "submission_count"> | Pick<PublicSession, "id" | "name" | "enabled" | "submission_count">[] | null }
    const sessions = ((links as unknown as Row[]) ?? [])
        .map((r) => Array.isArray(r.public_sessions) ? r.public_sessions[0] : r.public_sessions)
        .filter((s): s is NonNullable<typeof s> => !!s)

    return (
        <div className="flex flex-col gap-4">
            <header>
                <h2 className="h-section">Integrations</h2>
                <p className="mt-1 text-[13px] text-[color:var(--c-text-muted)]">
                    Connect this project to external services and shared submission surfaces.
                </p>
            </header>

            <div className="card-stack flex flex-col gap-4">
                <div className="rounded-[16px] border border-[color:var(--c-border)] bg-white p-5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                            <div className="text-[14px] font-bold">Public submission sessions</div>
                            <p className="mt-1 text-[13px] text-[color:var(--c-text-muted)]">
                                A session is a shareable link that can route public submissions to one or more projects.
                            </p>
                        </div>
                        <Link href="/sessions" className="btn-ghost">Manage sessions</Link>
                    </div>

                    {tableMissing ? (
                        <div className="mt-4 rounded-[12px] border border-dashed border-amber-300 bg-amber-50 p-3 text-[12.5px] text-amber-900">
                            Apply <code className="font-mono">supabase/migrations/0009_public_sessions_v2.sql</code> to enable public sessions.
                        </div>
                    ) : sessions.length === 0 ? (
                        <p className="mt-3 rounded-[10px] bg-[color:var(--c-surface-2)] px-3 py-2 text-[12.5px] text-[color:var(--c-text-muted)]">
                            No public session covers this project yet. Head to <Link href="/sessions" className="font-semibold underline">Sessions</Link> to create one and add this project.
                        </p>
                    ) : (
                        <ul className="mt-3 flex flex-col gap-2">
                            {sessions.map((s) => (
                                <li key={s.id}>
                                    <Link
                                        href={`/sessions/${s.id}`}
                                        className="flex items-center gap-3 rounded-[12px] border border-[color:var(--c-border)] px-3 py-2 hover:border-[color:var(--c-border-strong)]"
                                    >
                                        <span className="truncate text-[13.5px] font-semibold">{s.name}</span>
                                        <span
                                            className={
                                                s.enabled
                                                    ? "rounded-full bg-emerald-100 px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-[0.08em] text-emerald-800"
                                                    : "rounded-full bg-zinc-100 px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-[0.08em] text-zinc-700"
                                            }
                                        >
                                            {s.enabled ? "Live" : "Paused"}
                                        </span>
                                        <span className="grow" />
                                        <span className="text-[11.5px] tabular-nums text-[color:var(--c-text-muted)]">
                                            {s.submission_count} submission{s.submission_count === 1 ? "" : "s"}
                                        </span>
                                    </Link>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>

                <div className="rounded-[16px] border border-dashed border-[color:var(--c-border)] bg-white p-5 text-[13px] text-[color:var(--c-text-muted)]">
                    <div className="text-[14px] font-bold text-[color:var(--c-text)]">GitHub Issues sync</div>
                    <p className="mt-1">Two-way sync of issues with the linked GitHub repo.</p>
                </div>
            </div>
        </div>
    )
}
