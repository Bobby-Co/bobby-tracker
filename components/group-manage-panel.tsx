"use client"

import Link from "next/link"
import { useEffect, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import type { ProjectGroup } from "@/lib/supabase/types"
import { Spinner } from "@/components/spinner"
import { MultiDropdown } from "@/components/multi-dropdown"
import { GroupAiComposeButton } from "@/components/group-ai-compose-button"

interface MemberInfo {
    id: string
    name: string
    has_summary: boolean
}

interface ProjectOption {
    id: string
    name: string
}

type Action = "save" | "delete" | "addMembers" | "removeMember" | null

// Group management surface: rename + delete header, member panel,
// and the launch-pad for the AI compose flow. Mirrors
// SessionManagePanel's structure so the two object types feel
// related to the user.
export function GroupManagePanel({
    group: initial,
    members: initialMembers,
    allProjects,
}: {
    group: ProjectGroup
    members: MemberInfo[]
    allProjects: ProjectOption[]
}) {
    const router = useRouter()

    const [group, setGroup] = useState(initial)
    const [members, setMembers] = useState(initialMembers)
    const [name, setName] = useState(initial.name)
    const [description, setDescription] = useState(initial.description ?? "")
    const [pendingProjectIds, setPendingProjectIds] = useState<string[]>([])
    const [error, setError] = useState<string | null>(null)
    const [action, setAction] = useState<Action>(null)
    const [, startTransition] = useTransition()

    useEffect(() => {
        // Re-sync local form state with the server-rendered group
        // after a save / refresh. useState's initial value is only
        // honored on first mount; this keeps the panel in step.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setName(group.name)
        setDescription(group.description ?? "")
    }, [group.id, group.name, group.description])

    const busy = action !== null

    async function call(path: string, method: "POST" | "PATCH" | "DELETE", body?: unknown) {
        setError(null)
        const res = await fetch(path, {
            method,
            headers: body ? { "Content-Type": "application/json" } : undefined,
            body: body ? JSON.stringify(body) : undefined,
        })
        if (!res.ok && res.status !== 204) {
            const e = await res.json().catch(() => ({}))
            setError(e?.error?.message || `Failed (${res.status})`)
            return null
        }
        if (res.status === 204) return null
        return await res.json().catch(() => ({}))
    }

    function run(a: Exclude<Action, null>, fn: () => Promise<void>) {
        setAction(a)
        startTransition(async () => {
            try { await fn() } finally { setAction(null) }
        })
    }

    function saveDetails() {
        run("save", async () => {
            const data = await call(`/api/groups/${group.id}`, "PATCH", { name, description })
            if (data?.group) setGroup(data.group)
        })
    }

    function deleteGroup() {
        if (!confirm("Delete this group? Projects inside aren't affected.")) return
        run("delete", async () => {
            await call(`/api/groups/${group.id}`, "DELETE")
            router.push("/groups")
        })
    }

    function addMembers() {
        const ids = pendingProjectIds.filter(Boolean)
        if (ids.length === 0) return
        run("addMembers", async () => {
            const results = await Promise.all(
                ids.map((project_id) =>
                    call(`/api/groups/${group.id}/members`, "POST", { project_id }),
                ),
            )
            const successfullyAdded = ids.filter((_, i) => results[i] !== null || !error)
            const fresh = allProjects
                .filter((p) => successfullyAdded.includes(p.id))
                .map((p) => ({ id: p.id, name: p.name, has_summary: false }))
            setMembers((cur) =>
                [...cur, ...fresh.filter((p) => !cur.some((c) => c.id === p.id))]
                    .sort((a, b) => a.name.localeCompare(b.name)),
            )
            setPendingProjectIds([])
        })
    }

    function removeMember(projectId: string) {
        run("removeMember", async () => {
            await call(`/api/groups/${group.id}/members/${projectId}`, "DELETE")
            setMembers((cur) => cur.filter((m) => m.id !== projectId))
        })
    }

    const detailsDirty =
        name !== group.name || description !== (group.description ?? "")
    const availableToAdd = allProjects.filter((p) => !members.some((m) => m.id === p.id))
    const indexedMembers = members.filter((m) => m.has_summary).length

    return (
        <div className="mt-4 flex flex-col gap-4">
            {/* Compose CTA — the primary action on this page. */}
            <div className="rounded-[16px] border border-[color:var(--c-border)] bg-white p-4 sm:p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                        <div className="text-[14px] font-bold">Compose with AI</div>
                        <p className="mt-1 text-[13px] text-[color:var(--c-text-muted)]">
                            Drop in a paragraph and screenshots. The AI drafts an issue and ranks the group&apos;s projects so you can route it to the best match (or split it across several).
                        </p>
                    </div>
                    <GroupAiComposeButton
                        groupId={group.id}
                        members={members}
                        disabled={members.length === 0}
                        disabledReason={members.length === 0 ? "Add at least one project to this group first." : undefined}
                    />
                </div>
                {members.length > 0 && indexedMembers < members.length && (
                    <p className="mt-3 rounded-[10px] bg-amber-50 px-3 py-2 text-[12px] text-amber-900">
                        {members.length - indexedMembers} of {members.length} project{members.length === 1 ? "" : "s"} hasn&apos;t been indexed yet — those will still be selectable but won&apos;t carry a routing score until they get a summary embedding.
                    </p>
                )}
            </div>

            {/* Members */}
            <div className="rounded-[16px] border border-[color:var(--c-border)] bg-white p-4 sm:p-5">
                <div className="flex items-start justify-between gap-3">
                    <div>
                        <div className="text-[14px] font-bold">Projects in this group</div>
                        <p className="mt-1 text-[13px] text-[color:var(--c-text-muted)]">
                            The router picks among these. Keep them tightly scoped — generic groups dilute the per-facet signal.
                        </p>
                    </div>
                </div>

                {members.length === 0 ? (
                    <p className="mt-3 rounded-[10px] bg-[color:var(--c-surface-2)] px-3 py-2 text-[12.5px] text-[color:var(--c-text-muted)]">
                        No projects yet — add at least one to enable AI compose.
                    </p>
                ) : (
                    <ul className="mt-3 flex flex-wrap gap-2">
                        {members.map((m) => (
                            <li
                                key={m.id}
                                className="inline-flex items-center gap-1.5 rounded-full bg-[color:var(--c-surface-2)] px-2.5 py-1 text-[12.5px] font-semibold"
                            >
                                <Link href={`/projects/${m.id}/issues`} className="truncate hover:underline">
                                    {m.name}
                                </Link>
                                {!m.has_summary && (
                                    <span
                                        className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.06em] text-amber-800"
                                        title="No summary embedding yet — re-index on the project's Knowledge tab to enable routing."
                                    >
                                        no summary
                                    </span>
                                )}
                                <button
                                    type="button"
                                    onClick={() => removeMember(m.id)}
                                    disabled={busy}
                                    aria-label={`Remove ${m.name}`}
                                    className="grid h-4 w-4 place-items-center rounded-full text-[color:var(--c-text-dim)] hover:bg-white hover:text-rose-700"
                                >
                                    <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden>
                                        <path d="M6 6l12 12M18 6L6 18" />
                                    </svg>
                                </button>
                            </li>
                        ))}
                    </ul>
                )}

                {availableToAdd.length > 0 && (
                    <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-start">
                        <div className="w-full sm:max-w-xs">
                            <MultiDropdown<string>
                                values={pendingProjectIds}
                                onChange={setPendingProjectIds}
                                options={availableToAdd.map((p) => ({ value: p.id, label: p.name }))}
                                placeholder="Add projects…"
                                searchable={availableToAdd.length > 6}
                                disabled={busy}
                                aria-label="Projects to add"
                            />
                        </div>
                        <button
                            onClick={addMembers}
                            disabled={busy || pendingProjectIds.length === 0}
                            className="btn-primary w-full sm:w-auto"
                        >
                            {action === "addMembers"
                                ? (<><Spinner />Adding…</>)
                                : pendingProjectIds.length > 1
                                    ? `Add ${pendingProjectIds.length}`
                                    : "Add"}
                        </button>
                    </div>
                )}
            </div>

            {/* Details + delete */}
            <div className="rounded-[16px] border border-[color:var(--c-border)] bg-white p-4 sm:p-5">
                <div className="text-[14px] font-bold">Details</div>
                <fieldset disabled={busy} className="mt-3 grid grid-cols-1 gap-3">
                    <label className="flex flex-col gap-1">
                        <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-[color:var(--c-text-muted)]">
                            Name
                        </span>
                        <input
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            className="input text-[13px]"
                            placeholder="e.g. Bobby suite"
                            required
                        />
                    </label>
                    <label className="flex flex-col gap-1">
                        <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-[color:var(--c-text-muted)]">
                            Description <span className="font-medium normal-case tracking-normal text-[color:var(--c-text-dim)]">(optional)</span>
                        </span>
                        <textarea
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            rows={3}
                            className="input text-[13px]"
                            placeholder="What ties these projects together?"
                        />
                    </label>
                </fieldset>

                <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
                    <button onClick={deleteGroup} disabled={busy} className="btn-ghost text-rose-700 hover:bg-rose-50">
                        {action === "delete" ? (<><Spinner />Deleting…</>) : "Delete group"}
                    </button>
                    <button
                        onClick={saveDetails}
                        disabled={busy || !detailsDirty || !name.trim()}
                        className="btn-primary"
                    >
                        {action === "save" ? (<><Spinner />Saving…</>) : "Save details"}
                    </button>
                </div>
            </div>

            {error && (
                <p role="alert" className="rounded-[10px] bg-rose-50 px-3 py-2 text-[12.5px] text-rose-800">
                    {error}
                </p>
            )}
        </div>
    )
}
