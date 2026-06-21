"use client"

import Link from "next/link"
import { useParams } from "next/navigation"
import { useApi } from "@/lib/hooks/use-api"
import { useAuth } from "@/lib/auth/auth-context"
import type { PublicSession, PublicSessionInvite } from "@/lib/supabase/types"
import { SessionManagePanel } from "@/components/session-manage-panel"

interface ProjectOption {
    id: string
    name: string
}

// Per-session management page. Owners edit the public title/description,
// time window, project membership, and toggle pause/regenerate/delete
// from here. The single "session shape" (one or many projects) lives
// entirely in this view; the project's Integrations tab only links
// back to the sessions covering it.
export default function SessionDetailPage() {
    const { id } = useParams<{ id: string }>()
    const { user } = useAuth()
    const ownerEmail = (user?.email ?? "").trim().toLowerCase() || null

    const { data, error, loading } = useApi<{
        session: PublicSession
        projects: ProjectOption[]
        allProjects: ProjectOption[]
        invites: PublicSessionInvite[]
        allGroups: { id: string; name: string }[]
    }>(`/api/sessions/${id}`)

    return (
        <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6 sm:py-10">
            <Link
                href="/sessions"
                className="text-[11px] font-bold uppercase tracking-[0.12em] text-[color:var(--c-text-muted)] hover:text-[color:var(--c-text)]"
            >
                ← Sessions
            </Link>

            {loading ? (
                <div aria-busy className="mt-2 flex flex-col gap-4">
                    <div className="skeleton h-7 w-64 max-w-full rounded-[6px]" />
                    <div className="skeleton h-40 w-full rounded-[16px]" />
                    <div className="skeleton h-40 w-full rounded-[16px]" />
                </div>
            ) : error || !data ? (
                <div className="mt-3 rounded-[12px] border border-rose-200 bg-rose-50 px-4 py-3 text-[12.5px] text-rose-800">
                    {error ?? "Session not found."}
                </div>
            ) : (
                <>
                    <h1 className="mt-2 truncate text-[22px] font-bold tracking-[-0.012em]">{data.session.name}</h1>
                    <SessionManagePanel
                        session={data.session}
                        sessionProjects={data.projects}
                        allProjects={data.allProjects ?? []}
                        invites={data.invites ?? []}
                        ownerEmail={ownerEmail}
                        allGroups={data.allGroups}
                    />
                </>
            )}
        </div>
    )
}
