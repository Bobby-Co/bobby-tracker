"use client"

import { useEffect, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import type { PublicSession } from "@/lib/supabase/types"
import { Spinner } from "@/components/spinner"

type Action =
    | "save" | "rotate" | "toggle" | "delete"
    | "addProject" | "removeProject"
    | null

interface ProjectOption {
    id: string
    name: string
}

function isoToLocalInput(iso: string | null | undefined): string {
    if (!iso) return ""
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return ""
    const offset = d.getTimezoneOffset() * 60_000
    return new Date(d.getTime() - offset).toISOString().slice(0, 16)
}
function localInputToIso(v: string): string | null {
    if (!v) return null
    const t = Date.parse(v)
    return Number.isNaN(t) ? null : new Date(t).toISOString()
}

// Single panel that owns the entire session lifecycle: name/title/desc,
// time window, project membership, pause/regenerate/delete. Tracks
// which specific action is in flight so we spinner only the relevant
// button instead of disabling the whole thing.
export function SessionManagePanel({
    session: initial,
    sessionProjects: initialProjects,
    allProjects,
}: {
    session: PublicSession
    sessionProjects: ProjectOption[]
    allProjects: ProjectOption[]
}) {
    const router = useRouter()

    const [session, setSession] = useState<PublicSession>(initial)
    const [projects, setProjects] = useState<ProjectOption[]>(initialProjects)

    const [name, setName] = useState(initial.name)
    const [title, setTitle] = useState(initial.title ?? "")
    const [description, setDescription] = useState(initial.description ?? "")
    const [startAt, setStartAt] = useState(isoToLocalInput(initial.start_at))
    const [endAt, setEndAt] = useState(isoToLocalInput(initial.end_at))

    const [origin, setOrigin] = useState("")
    const [copied, setCopied] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [action, setAction] = useState<Action>(null)
    const [pendingProjectId, setPendingProjectId] = useState<string>("")
    const [, startTransition] = useTransition()

    useEffect(() => {
        if (typeof window !== "undefined") setOrigin(window.location.origin)
    }, [])

    useEffect(() => {
        setName(session.name)
        setTitle(session.title ?? "")
        setDescription(session.description ?? "")
        setStartAt(isoToLocalInput(session.start_at))
        setEndAt(isoToLocalInput(session.end_at))
    }, [session.id, session.token, session.start_at, session.end_at, session.name, session.title, session.description])

    const link = origin ? `${origin}/p/${session.token}` : ""
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
            const data = await call(`/api/sessions/${session.id}`, "PATCH", {
                name, title, description,
                start_at: localInputToIso(startAt),
                end_at: localInputToIso(endAt),
            })
            if (data?.session) setSession(data.session)
        })
    }

    function rotate() {
        if (!confirm("Regenerate the link? The current URL will stop working.")) return
        run("rotate", async () => {
            const data = await call(`/api/sessions/${session.id}/rotate`, "POST")
            if (data?.session) setSession(data.session)
        })
    }

    function togglePaused() {
        run("toggle", async () => {
            const data = await call(`/api/sessions/${session.id}`, "PATCH", { enabled: !session.enabled })
            if (data?.session) setSession(data.session)
        })
    }

    function deleteSession() {
        if (!confirm("Delete this session? Any existing URL will stop working and submissions stop.")) return
        run("delete", async () => {
            await call(`/api/sessions/${session.id}`, "DELETE")
            router.push("/sessions")
        })
    }

    function addProject() {
        if (!pendingProjectId) return
        run("addProject", async () => {
            const ok = await call(`/api/sessions/${session.id}/projects`, "POST", { project_id: pendingProjectId })
            if (!ok && error) return
            const proj = allProjects.find((p) => p.id === pendingProjectId)
            if (proj) setProjects((cur) => [...cur, proj].sort((a, b) => a.name.localeCompare(b.name)))
            setPendingProjectId("")
        })
    }

    function removeProject(projectId: string) {
        run("removeProject", async () => {
            await call(`/api/sessions/${session.id}/projects/${projectId}`, "DELETE")
            setProjects((cur) => cur.filter((p) => p.id !== projectId))
        })
    }

    async function copy() {
        if (!link) return
        try {
            await navigator.clipboard.writeText(link)
            setCopied(true)
            setTimeout(() => setCopied(false), 1500)
        } catch {
            setError("Couldn't copy — copy manually.")
        }
    }

    const detailsDirty =
        name !== session.name
        || title !== (session.title ?? "")
        || description !== (session.description ?? "")
        || startAt !== isoToLocalInput(session.start_at)
        || endAt !== isoToLocalInput(session.end_at)

    const windowInverted = !!startAt && !!endAt && Date.parse(startAt) >= Date.parse(endAt)
    const availableToAdd = allProjects.filter((p) => !projects.some((sp) => sp.id === p.id))

    return (
        <div className="mt-4 flex flex-col gap-4">
            {/* Status / link */}
            <div className="rounded-[16px] border border-[color:var(--c-border)] bg-white p-4 sm:p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                        <div className="text-[14px] font-bold">Public link</div>
                        <p className="mt-1 text-[13px] text-[color:var(--c-text-muted)]">
                            Anyone with this URL can submit — no login required.
                        </p>
                    </div>
                    <span
                        className={
                            session.enabled
                                ? "rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-bold uppercase tracking-[0.08em] text-emerald-800"
                                : "rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-bold uppercase tracking-[0.08em] text-zinc-700"
                        }
                    >
                        {session.enabled ? "Live" : "Paused"}
                    </span>
                </div>
                <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
                    <input
                        readOnly
                        value={link || ""}
                        onFocus={(e) => e.currentTarget.select()}
                        className="input flex-1 font-mono text-[12px]"
                        aria-label="Public submission link"
                    />
                    <div className="grid grid-cols-2 gap-2 sm:flex">
                        <button onClick={copy} className="btn-ghost" disabled={busy || !link}>
                            {copied ? "Copied" : "Copy"}
                        </button>
                        <a href={link || "#"} target="_blank" rel="noreferrer" className="btn-ghost">
                            Open
                        </a>
                    </div>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2 text-[12px] text-[color:var(--c-text-muted)]">
                    <span className="tabular-nums">
                        {session.submission_count} submission{session.submission_count === 1 ? "" : "s"}
                    </span>
                    <span className="grow" />
                    <button onClick={togglePaused} disabled={busy} className="btn-ghost">
                        {action === "toggle"
                            ? (<><Spinner />{session.enabled ? "Pausing…" : "Resuming…"}</>)
                            : (session.enabled ? "Pause" : "Resume")}
                    </button>
                    <button onClick={rotate} disabled={busy} className="btn-ghost">
                        {action === "rotate" ? (<><Spinner />Regenerating…</>) : "Regenerate link"}
                    </button>
                    <button onClick={deleteSession} disabled={busy} className="btn-ghost text-rose-700 hover:bg-rose-50">
                        {action === "delete" ? (<><Spinner />Deleting…</>) : "Delete session"}
                    </button>
                </div>
            </div>

            {/* Projects */}
            <div className="rounded-[16px] border border-[color:var(--c-border)] bg-white p-4 sm:p-5">
                <div className="flex items-start justify-between gap-3">
                    <div>
                        <div className="text-[14px] font-bold">Projects in this session</div>
                        <p className="mt-1 text-[13px] text-[color:var(--c-text-muted)]">
                            Submitters pick one of these when filing an issue.
                        </p>
                    </div>
                </div>

                {projects.length === 0 ? (
                    <p className="mt-3 rounded-[10px] bg-[color:var(--c-surface-2)] px-3 py-2 text-[12.5px] text-[color:var(--c-text-muted)]">
                        No projects yet — add at least one or the link will show an empty state.
                    </p>
                ) : (
                    <ul className="mt-3 flex flex-wrap gap-2">
                        {projects.map((p) => (
                            <li
                                key={p.id}
                                className="inline-flex items-center gap-1.5 rounded-full bg-[color:var(--c-surface-2)] px-2.5 py-1 text-[12.5px] font-semibold"
                            >
                                <span className="truncate">{p.name}</span>
                                <button
                                    type="button"
                                    onClick={() => removeProject(p.id)}
                                    disabled={busy}
                                    aria-label={`Remove ${p.name}`}
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
                    <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
                        <select
                            value={pendingProjectId}
                            onChange={(e) => setPendingProjectId(e.target.value)}
                            disabled={busy}
                            className="input text-[13px] sm:max-w-xs"
                        >
                            <option value="">Add a project…</option>
                            {availableToAdd.map((p) => (
                                <option key={p.id} value={p.id}>{p.name}</option>
                            ))}
                        </select>
                        <button
                            onClick={addProject}
                            disabled={busy || !pendingProjectId}
                            className="btn-primary w-full sm:w-auto"
                        >
                            {action === "addProject" ? (<><Spinner />Adding…</>) : "Add"}
                        </button>
                    </div>
                )}
            </div>

            {/* Details + window */}
            <div className="rounded-[16px] border border-[color:var(--c-border)] bg-white p-4 sm:p-5">
                <div className="text-[14px] font-bold">Public details</div>
                <p className="mt-1 text-[13px] text-[color:var(--c-text-muted)]">
                    What submitters see at the top of the form.
                </p>
                <fieldset disabled={busy} className="mt-3 grid grid-cols-1 gap-3">
                    <label className="flex flex-col gap-1">
                        <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-[color:var(--c-text-muted)]">
                            Internal name
                        </span>
                        <input
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            className="input text-[13px]"
                            placeholder="Beta feedback Q2"
                            required
                        />
                    </label>
                    <label className="flex flex-col gap-1">
                        <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-[color:var(--c-text-muted)]">
                            Public heading
                        </span>
                        <input
                            value={title}
                            onChange={(e) => setTitle(e.target.value)}
                            className="input text-[13px]"
                            placeholder="Defaults to the internal name"
                        />
                    </label>
                    <label className="flex flex-col gap-1">
                        <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-[color:var(--c-text-muted)]">
                            Public description
                        </span>
                        <textarea
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            rows={3}
                            placeholder="What kinds of issues are you collecting? (markdown supported)"
                            className="input text-[13px]"
                        />
                    </label>

                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <label className="flex flex-col gap-1">
                            <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-[color:var(--c-text-muted)]">
                                Opens at <span className="font-medium normal-case tracking-normal text-[color:var(--c-text-dim)]">(optional)</span>
                            </span>
                            <input
                                type="datetime-local"
                                value={startAt}
                                onChange={(e) => setStartAt(e.target.value)}
                                max={endAt || undefined}
                                className="input text-[13px]"
                            />
                        </label>
                        <label className="flex flex-col gap-1">
                            <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-[color:var(--c-text-muted)]">
                                Closes at <span className="font-medium normal-case tracking-normal text-[color:var(--c-text-dim)]">(optional)</span>
                            </span>
                            <input
                                type="datetime-local"
                                value={endAt}
                                onChange={(e) => setEndAt(e.target.value)}
                                min={startAt || undefined}
                                className="input text-[13px]"
                            />
                        </label>
                    </div>
                    {windowInverted && <p className="text-[11.5px] text-rose-700">Closes-at must be after opens-at.</p>}
                    {(startAt || endAt) && !windowInverted && (
                        <p className="text-[11.5px] text-[color:var(--c-text-dim)]">
                            Times use your browser's timezone. Submitters see the same wall-clock window.
                        </p>
                    )}
                </fieldset>

                <div className="mt-3 flex justify-end">
                    <button
                        onClick={saveDetails}
                        disabled={busy || !detailsDirty || windowInverted || !name.trim()}
                        className="btn-primary w-full sm:w-auto"
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
