"use client"

import { useState } from "react"
import { useAuth } from "@/lib/auth/auth-context"
import { useApi } from "@/lib/hooks/use-api"
import { ApiError, apiMutate } from "@/lib/platform/http/api-client"
import { cn } from "@/components/ui/cn"
import { TEAM_ROLES, type TeamInvite, type TeamMemberView, type TeamRole, type TeamWithRole } from "@/lib/supabase/types"

export function MembersTab({ team, isAdmin }: { team: TeamWithRole; isAdmin: boolean }) {
    const { user } = useAuth()
    const membersQ = useApi<{ members: TeamMemberView[] }>(`/api/teams/${team.id}/members`)
    const invitesQ = useApi<{ invites: TeamInvite[] }>(isAdmin ? `/api/teams/${team.id}/invites` : null, { enabled: isAdmin })

    const members = membersQ.data?.members ?? []
    const invites = invitesQ.data?.invites ?? []

    async function changeRole(userId: string, role: TeamRole) {
        try {
            await apiMutate(`/api/teams/${team.id}/members/${userId}`, { method: "PATCH", body: { role } })
        } catch (e) {
            if (!(e instanceof ApiError)) throw e
            alert(e.message)
        }
        membersQ.refetch()
    }
    async function removeMember(userId: string) {
        try {
            await apiMutate(`/api/teams/${team.id}/members/${userId}`, { method: "DELETE" })
        } catch (e) {
            if (!(e instanceof ApiError)) throw e
            return alert(e.message)
        }
        membersQ.refetch()
    }
    async function revokeInvite(token: string) {
        try {
            await apiMutate(`/api/teams/${team.id}/invites/${token}`, { method: "DELETE" })
        } catch (e) {
            if (!(e instanceof ApiError)) throw e
        }
        invitesQ.refetch()
    }

    return (
        <div className="space-y-8">
            {isAdmin && !team.is_personal && (
                <InviteForm teamId={team.id} onInvited={() => invitesQ.refetch()} />
            )}

            <section>
                <h2 className="mb-2 text-[13px] font-bold text-[color:var(--c-text)]">Members</h2>
                {membersQ.loading ? (
                    <div className="skeleton h-24 w-full rounded-[14px]" />
                ) : (
                    <ul className="divide-y divide-[color:var(--c-border)] overflow-hidden rounded-[14px] border border-[color:var(--c-border)] bg-white">
                        {members.map((m) => {
                            const isSelf = m.user_id === user?.id
                            const canEdit = isAdmin && !(m.role === "owner" && team.role !== "owner")
                            return (
                                <li key={m.user_id} className="flex items-center gap-3 px-4 py-2.5">
                                    <Avatar name={m.name ?? m.email ?? "?"} url={m.avatar_url} />
                                    <div className="min-w-0 flex-1">
                                        <div className="truncate text-[13px] font-semibold">
                                            {m.name ?? m.email ?? m.user_id}
                                            {isSelf && <span className="ml-1.5 text-[11px] font-normal text-[color:var(--c-text-muted)]">(you)</span>}
                                        </div>
                                        {m.email && m.name && <div className="truncate text-[12px] text-[color:var(--c-text-muted)]">{m.email}</div>}
                                    </div>
                                    {canEdit && !isSelf ? (
                                        <select
                                            value={m.role}
                                            onChange={(e) => changeRole(m.user_id, e.target.value as TeamRole)}
                                            className="h-8 rounded-[8px] border border-[color:var(--c-border)] bg-[color:var(--c-surface)] px-2 text-[12.5px] capitalize outline-none focus:border-[color:var(--c-primary)]"
                                        >
                                            {TEAM_ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                                        </select>
                                    ) : (
                                        <span className="rounded-full bg-[color:var(--c-surface-2)] px-2 py-0.5 text-[11px] font-semibold capitalize text-[color:var(--c-text-muted)]">{m.role}</span>
                                    )}
                                    {(isAdmin || isSelf) && !(m.role === "owner" && members.filter((x) => x.role === "owner").length === 1) && (
                                        <button
                                            type="button"
                                            onClick={() => removeMember(m.user_id)}
                                            title={isSelf ? "Leave team" : "Remove member"}
                                            className="grid h-8 w-8 place-items-center rounded-[8px] text-[color:var(--c-text-dim)] transition-colors hover:bg-rose-50 hover:text-rose-600"
                                        >
                                            <TrashIcon />
                                        </button>
                                    )}
                                </li>
                            )
                        })}
                    </ul>
                )}
            </section>

            {isAdmin && invites.length > 0 && (
                <section>
                    <h2 className="mb-2 text-[13px] font-bold text-[color:var(--c-text)]">Pending invites</h2>
                    <ul className="divide-y divide-[color:var(--c-border)] overflow-hidden rounded-[14px] border border-[color:var(--c-border)] bg-white">
                        {invites.map((inv) => (
                            <li key={inv.token} className="flex items-center gap-3 px-4 py-2.5">
                                <div className="min-w-0 flex-1">
                                    <div className="truncate text-[13px] font-semibold">{inv.email}</div>
                                    <div className="text-[11.5px] text-[color:var(--c-text-muted)]">invited as {inv.role} · pending</div>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => revokeInvite(inv.token)}
                                    className="rounded-[8px] border border-[color:var(--c-border)] px-2.5 py-1 text-[12px] font-medium text-[color:var(--c-text-muted)] transition-colors hover:border-rose-300 hover:text-rose-600"
                                >
                                    Revoke
                                </button>
                            </li>
                        ))}
                    </ul>
                </section>
            )}
        </div>
    )
}

function InviteForm({ teamId, onInvited }: { teamId: string; onInvited: () => void }) {
    const [email, setEmail] = useState("")
    const [role, setRole] = useState<TeamRole>("member")
    const [busy, setBusy] = useState(false)
    const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

    async function submit(e: React.FormEvent) {
        e.preventDefault()
        setBusy(true)
        setMsg(null)
        try {
            await apiMutate(`/api/teams/${teamId}/invites`, { method: "POST", body: { email: email.trim(), role } })
            setMsg({ ok: true, text: `Invitation sent to ${email.trim()}` })
            setEmail("")
            onInvited()
        } catch (e) {
            setMsg({ ok: false, text: e instanceof ApiError ? e.message : "Network error" })
        } finally {
            setBusy(false)
        }
    }

    return (
        <section>
            <h2 className="mb-2 text-[13px] font-bold text-[color:var(--c-text)]">Invite people</h2>
            <form onSubmit={submit} className="flex flex-wrap items-center gap-2">
                <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="name@company.com"
                    disabled={busy}
                    className="h-9 min-w-[220px] flex-1 rounded-[10px] border border-[color:var(--c-border)] bg-[color:var(--c-surface)] px-3 text-[13px] outline-none focus:border-[color:var(--c-primary)] focus:ring-[3px] focus:ring-[color:var(--c-ring)]"
                />
                <select
                    value={role}
                    onChange={(e) => setRole(e.target.value as TeamRole)}
                    className="h-9 rounded-[10px] border border-[color:var(--c-border)] bg-[color:var(--c-surface)] px-2.5 text-[13px] capitalize outline-none focus:border-[color:var(--c-primary)]"
                >
                    <option value="member">member</option>
                    <option value="admin">admin</option>
                </select>
                <button
                    type="submit"
                    disabled={busy || !email.trim()}
                    className="h-9 rounded-[10px] bg-[color:var(--c-primary)] px-4 text-[13px] font-semibold text-white disabled:opacity-50"
                >
                    {busy ? "Sending…" : "Send invite"}
                </button>
            </form>
            {msg && (
                <p className={cn("mt-2 text-[12px]", msg.ok ? "text-emerald-600" : "text-rose-600")}>{msg.text}</p>
            )}
        </section>
    )
}

function Avatar({ name, url }: { name: string; url: string | null }) {
    const initials = name.split(/\s+/).slice(0, 2).map((s) => s[0]?.toUpperCase() ?? "").join("") || "?"
    if (url) {
        // eslint-disable-next-line @next/next/no-img-element
        return <img src={url} alt="" className="h-8 w-8 shrink-0 rounded-full object-cover" />
    }
    return (
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-zinc-200 text-[11px] font-bold text-zinc-600">
            {initials}
        </span>
    )
}

function TrashIcon() {
    return (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m2 0v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6" />
        </svg>
    )
}
