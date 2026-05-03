"use client"

import { useEffect, useState, useTransition } from "react"
import type { ProjectPublicSession } from "@/lib/supabase/types"

// Owner-facing manager for a project's public submission link. Lives
// on the Integrations tab. Handles enable/create, regenerate, toggle
// pause, edit public title/description, copy link, and disable.
export function PublicSessionPanel({
    projectId,
    initialSession,
}: {
    projectId: string
    initialSession: ProjectPublicSession | null
}) {
    const [session, setSession] = useState<ProjectPublicSession | null>(initialSession)
    const [title, setTitle] = useState(initialSession?.title ?? "")
    const [description, setDescription] = useState(initialSession?.description ?? "")
    const [origin, setOrigin] = useState("")
    const [error, setError] = useState<string | null>(null)
    const [copied, setCopied] = useState(false)
    const [pending, startTransition] = useTransition()

    useEffect(() => {
        if (typeof window !== "undefined") setOrigin(window.location.origin)
    }, [])

    useEffect(() => {
        setTitle(session?.title ?? "")
        setDescription(session?.description ?? "")
    }, [session?.token])

    const link = session ? `${origin}/p/${session.token}` : ""

    async function call(method: "POST" | "PATCH" | "DELETE", body?: unknown) {
        setError(null)
        const res = await fetch(`/api/projects/${projectId}/public-session`, {
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
        const data = await res.json().catch(() => ({}))
        return data?.session as ProjectPublicSession | null
    }

    function enable() {
        startTransition(async () => {
            const s = await call("POST", { title, description })
            if (s) setSession(s)
        })
    }

    function rotate() {
        if (!confirm("Regenerate the link? The current URL will stop working.")) return
        startTransition(async () => {
            const s = await call("POST", { title, description })
            if (s) setSession(s)
        })
    }

    function togglePaused() {
        if (!session) return
        startTransition(async () => {
            const s = await call("PATCH", { enabled: !session.enabled })
            if (s) setSession(s)
        })
    }

    function saveDetails() {
        startTransition(async () => {
            const s = await call("PATCH", { title, description })
            if (s) setSession(s)
        })
    }

    function disable() {
        if (!confirm("Delete the public link? Any existing URL will stop working.")) return
        startTransition(async () => {
            await call("DELETE")
            setSession(null)
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

    return (
        <div className="rounded-[16px] border border-[color:var(--c-border)] bg-white p-5">
            <div className="flex items-start justify-between gap-3">
                <div>
                    <div className="text-[14px] font-bold text-[color:var(--c-text)]">Public issue session</div>
                    <p className="mt-1 text-[13px] text-[color:var(--c-text-muted)]">
                        Share a link so anyone — no login — can file an issue against this project.
                    </p>
                </div>
                {session && (
                    <span
                        className={
                            session.enabled
                                ? "rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-bold uppercase tracking-[0.08em] text-emerald-800"
                                : "rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-bold uppercase tracking-[0.08em] text-zinc-700"
                        }
                    >
                        {session.enabled ? "Live" : "Paused"}
                    </span>
                )}
            </div>

            {!session ? (
                <div className="mt-4">
                    <button onClick={enable} disabled={pending} className="btn-primary">
                        {pending ? "Creating…" : "Create public link"}
                    </button>
                </div>
            ) : (
                <div className="mt-4 flex flex-col gap-4">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                        <input
                            readOnly
                            value={link}
                            onFocus={(e) => e.currentTarget.select()}
                            className="input flex-1 font-mono text-[12px]"
                        />
                        <div className="flex gap-2">
                            <button onClick={copy} className="btn-ghost" disabled={pending}>
                                {copied ? "Copied" : "Copy"}
                            </button>
                            <a href={link} target="_blank" rel="noreferrer" className="btn-ghost">
                                Open
                            </a>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 gap-2">
                        <label className="text-[11px] font-bold uppercase tracking-[0.08em] text-[color:var(--c-text-muted)]">
                            Public heading
                        </label>
                        <input
                            value={title}
                            onChange={(e) => setTitle(e.target.value)}
                            placeholder="Report an issue"
                            className="input text-[13px]"
                        />
                        <label className="mt-1 text-[11px] font-bold uppercase tracking-[0.08em] text-[color:var(--c-text-muted)]">
                            Public description
                        </label>
                        <textarea
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            rows={3}
                            placeholder="What kinds of issues are you collecting? (markdown supported)"
                            className="input text-[13px]"
                        />
                        <div className="flex justify-end">
                            <button
                                onClick={saveDetails}
                                disabled={
                                    pending ||
                                    (title === (session.title ?? "") && description === (session.description ?? ""))
                                }
                                className="btn-primary"
                            >
                                Save details
                            </button>
                        </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 border-t border-[color:var(--c-border)] pt-3">
                        <span className="text-[12px] text-[color:var(--c-text-muted)]">
                            {session.submission_count} submission{session.submission_count === 1 ? "" : "s"}
                        </span>
                        <span className="grow" />
                        <button onClick={togglePaused} disabled={pending} className="btn-ghost">
                            {session.enabled ? "Pause" : "Resume"}
                        </button>
                        <button onClick={rotate} disabled={pending} className="btn-ghost">
                            Regenerate link
                        </button>
                        <button
                            onClick={disable}
                            disabled={pending}
                            className="btn-ghost text-rose-700 hover:bg-rose-50"
                        >
                            Delete
                        </button>
                    </div>
                </div>
            )}

            {error && <p className="mt-3 text-[12px] text-rose-700">{error}</p>}
        </div>
    )
}
