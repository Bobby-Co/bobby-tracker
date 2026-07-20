"use client"

import { useState } from "react"
import { useApi } from "@/lib/hooks/use-api"
import { ApiError, apiMutate } from "@/lib/api-client"
import { cn } from "@/components/ui/cn"
import type { AccessGroupWithDetail, Project, TeamMemberView, TeamWithRole } from "@/lib/supabase/types"

export function GroupsTab({ team, isAdmin }: { team: TeamWithRole; isAdmin: boolean }) {
    const groupsQ = useApi<{ groups: AccessGroupWithDetail[] }>(`/api/teams/${team.id}/groups`)
    const membersQ = useApi<{ members: TeamMemberView[] }>(`/api/teams/${team.id}/members`)
    const projectsQ = useApi<{ projects: Project[] }>("/api/projects")

    const groups = groupsQ.data?.groups ?? []
    const members = membersQ.data?.members ?? []
    const projects = projectsQ.data?.projects ?? []

    return (
        <div className="space-y-6">
            <div className="flex items-start justify-between gap-3">
                <p className="max-w-xl text-[12.5px] text-[color:var(--c-text-muted)]">
                    A <strong>group</strong> is a set of people. Grant it projects, and its members can access exactly those.
                    Team admins and owners always see every project.
                </p>
                {isAdmin && !team.is_personal && <NewGroup teamId={team.id} onCreated={() => groupsQ.refetch()} />}
            </div>

            {groupsQ.loading ? (
                <div className="skeleton h-40 w-full rounded-[16px]" />
            ) : groups.length === 0 ? (
                <div className="rounded-[16px] border border-dashed border-[color:var(--c-border)] bg-white p-8 text-center text-[13px] text-[color:var(--c-text-muted)]">
                    <div className="text-[14px] font-bold text-[color:var(--c-text)]">No groups yet</div>
                    <p className="mt-1">Create a group, add people, and grant it the projects they should access.</p>
                </div>
            ) : (
                <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))" }}>
                    {groups.map((g) => (
                        <GroupCard
                            key={g.id}
                            group={g}
                            teamId={team.id}
                            isAdmin={isAdmin}
                            allMembers={members}
                            allProjects={projects}
                            onChange={() => groupsQ.refetch()}
                        />
                    ))}
                </div>
            )}
        </div>
    )
}

function GroupCard({
    group, teamId, isAdmin, allMembers, allProjects, onChange,
}: {
    group: AccessGroupWithDetail
    teamId: string
    isAdmin: boolean
    allMembers: TeamMemberView[]
    allProjects: Project[]
    onChange: () => void
}) {
    const base = `/api/teams/${teamId}/groups/${group.id}`
    const memberIds = new Set(group.members.map((m) => m.user_id))
    const grantedIds = new Set(group.project_ids)
    const addableMembers = allMembers.filter((m) => !memberIds.has(m.user_id))
    const addableProjects = allProjects.filter((p) => !grantedIds.has(p.id))
    const projectName = (id: string) => allProjects.find((p) => p.id === id)?.name ?? id

    async function addMember(userId: string) {
        try {
            await apiMutate(`${base}/members`, { method: "POST", body: { user_id: userId } })
        } catch (e) {
            if (!(e instanceof ApiError)) throw e
        }
        onChange()
    }
    async function removeMember(userId: string) {
        try {
            await apiMutate(`${base}/members/${userId}`, { method: "DELETE" })
        } catch (e) {
            if (!(e instanceof ApiError)) throw e
        }
        onChange()
    }
    async function grantProject(projectId: string) {
        try {
            await apiMutate(`${base}/projects`, { method: "POST", body: { project_id: projectId } })
        } catch (e) {
            if (!(e instanceof ApiError)) throw e
        }
        onChange()
    }
    async function revokeProject(projectId: string) {
        try {
            await apiMutate(`${base}/projects/${projectId}`, { method: "DELETE" })
        } catch (e) {
            if (!(e instanceof ApiError)) throw e
        }
        onChange()
    }
    async function remove() {
        if (!confirm(`Delete the group “${group.name}”? Its members lose access to its projects.`)) return
        try {
            await apiMutate(base, { method: "DELETE" })
        } catch (e) {
            if (!(e instanceof ApiError)) throw e
        }
        onChange()
    }

    return (
        <div className="flex flex-col gap-3 rounded-[16px] border border-[color:var(--c-border)] bg-white p-4">
            <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                    <div className="truncate text-[14px] font-bold">{group.name}</div>
                    {group.description && <div className="mt-0.5 truncate text-[12px] text-[color:var(--c-text-muted)]">{group.description}</div>}
                </div>
                {isAdmin && (
                    <button type="button" onClick={remove} title="Delete group" className="grid h-7 w-7 shrink-0 place-items-center rounded-[7px] text-[color:var(--c-text-dim)] hover:bg-rose-50 hover:text-rose-600">
                        <TrashIcon />
                    </button>
                )}
            </div>

            <Section title={`People (${group.members.length})`}>
                <div className="flex flex-wrap gap-1.5">
                    {group.members.map((m) => (
                        <Chip key={m.user_id} label={m.name ?? m.email ?? m.user_id} onRemove={isAdmin ? () => removeMember(m.user_id) : undefined} />
                    ))}
                    {group.members.length === 0 && <span className="text-[12px] text-[color:var(--c-text-dim)]">No one yet</span>}
                </div>
                {isAdmin && addableMembers.length > 0 && (
                    <AddPicker
                        placeholder="Add person…"
                        options={addableMembers.map((m) => ({ value: m.user_id, label: m.name ?? m.email ?? m.user_id }))}
                        onPick={addMember}
                    />
                )}
            </Section>

            <Section title={`Projects (${group.project_ids.length})`}>
                <div className="flex flex-wrap gap-1.5">
                    {group.project_ids.map((pid) => (
                        <Chip key={pid} label={projectName(pid)} onRemove={isAdmin ? () => revokeProject(pid) : undefined} />
                    ))}
                    {group.project_ids.length === 0 && <span className="text-[12px] text-[color:var(--c-text-dim)]">No projects granted</span>}
                </div>
                {isAdmin && addableProjects.length > 0 && (
                    <AddPicker
                        placeholder="Grant project…"
                        options={addableProjects.map((p) => ({ value: p.id, label: p.name }))}
                        onPick={grantProject}
                    />
                )}
            </Section>
        </div>
    )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <div>
            <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-[color:var(--c-text-muted)]">{title}</div>
            <div className="space-y-2">{children}</div>
        </div>
    )
}

function Chip({ label, onRemove }: { label: string; onRemove?: () => void }) {
    return (
        <span className="inline-flex items-center gap-1 rounded-full bg-[color:var(--c-surface-2)] py-1 pl-2.5 pr-1.5 text-[12px] font-medium text-[color:var(--c-text)]">
            <span className="max-w-[140px] truncate">{label}</span>
            {onRemove && (
                <button type="button" onClick={onRemove} className="grid h-4 w-4 place-items-center rounded-full text-[color:var(--c-text-dim)] hover:bg-rose-100 hover:text-rose-600" aria-label={`Remove ${label}`}>
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden><path d="M6 6l12 12M18 6L6 18" /></svg>
                </button>
            )}
        </span>
    )
}

function AddPicker({ placeholder, options, onPick }: { placeholder: string; options: { value: string; label: string }[]; onPick: (v: string) => void }) {
    return (
        <select
            value=""
            onChange={(e) => { if (e.target.value) onPick(e.target.value) }}
            className={cn(
                "h-8 w-full rounded-[8px] border border-dashed border-[color:var(--c-border)] bg-[color:var(--c-surface)] px-2 text-[12.5px] text-[color:var(--c-text-muted)] outline-none focus:border-[color:var(--c-primary)]",
            )}
        >
            <option value="">{placeholder}</option>
            {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
    )
}

function NewGroup({ teamId, onCreated }: { teamId: string; onCreated: () => void }) {
    const [open, setOpen] = useState(false)
    const [name, setName] = useState("")
    const [busy, setBusy] = useState(false)

    async function submit(e: React.FormEvent) {
        e.preventDefault()
        if (!name.trim()) return
        setBusy(true)
        try {
            await apiMutate(`/api/teams/${teamId}/groups`, { method: "POST", body: { name: name.trim() } })
            setName(""); setOpen(false); onCreated()
        } catch (e) {
            if (!(e instanceof ApiError)) throw e
            alert(e.message ?? "Couldn't create group")
        } finally { setBusy(false) }
    }

    if (!open) {
        return (
            <button type="button" onClick={() => setOpen(true)} className="h-9 shrink-0 rounded-[10px] bg-[color:var(--c-primary)] px-3.5 text-[13px] font-semibold text-white">
                + New group
            </button>
        )
    }
    return (
        <form onSubmit={submit} className="flex shrink-0 items-center gap-1.5">
            <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Group name" disabled={busy}
                className="h-9 w-40 rounded-[10px] border border-[color:var(--c-border)] bg-[color:var(--c-surface)] px-2.5 text-[13px] outline-none focus:border-[color:var(--c-primary)]" />
            <button type="submit" disabled={busy || !name.trim()} className="h-9 rounded-[10px] bg-[color:var(--c-primary)] px-3 text-[13px] font-semibold text-white disabled:opacity-50">Create</button>
            <button type="button" onClick={() => { setOpen(false); setName("") }} className="h-9 rounded-[10px] border border-[color:var(--c-border)] px-2.5 text-[13px]">Cancel</button>
        </form>
    )
}

function TrashIcon() {
    return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m2 0v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6" />
        </svg>
    )
}
