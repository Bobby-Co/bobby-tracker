"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState, useTransition } from "react"
import { ISSUE_PRIORITIES } from "@/lib/supabase/types"
import type { IssuePriority } from "@/lib/supabase/types"
import { Dropdown } from "@/components/dropdown"
import { Spinner } from "@/components/spinner"
import { PublicAiComposeButton } from "@/components/public-ai-compose-button"
import { readName, readReporterId } from "@/lib/public-profile"

const PRIORITY_OPTIONS = ISSUE_PRIORITIES.map((p) => ({ value: p, label: p }))
const MAX_TITLE = 200
const MAX_BODY = 10_000

interface ProjectOption {
    id: string
    name: string
}

// Anonymous issue submission form for /p/<token>. The submitter's
// display name + stable reporter id come from the global profile
// (PublicProfileBadge / localStorage) — not collected per-submission.
// The session can cover one or more projects; when there's more than
// one, a project picker is rendered so the submitter can route their
// report. On success the new issue lands in the server-rendered
// "All submissions" listing (router.refresh) so the visitor sees it
// in their reporter group right away.
export function PublicIssueForm({
    token,
    projects,
}: {
    token: string
    projects: ProjectOption[]
}) {
    const router = useRouter()
    const [projectId, setProjectId] = useState<string>(projects[0]?.id ?? "")
    const [title, setTitle] = useState("")
    const [body, setBody] = useState("")
    const [priority, setPriority] = useState<IssuePriority>("medium")
    const [error, setError] = useState<string | null>(null)
    const [submitted, setSubmitted] = useState<{ id: string; issue_number: number } | null>(null)
    const [pending, startTransition] = useTransition()

    function submit(e: React.FormEvent) {
        e.preventDefault()
        setError(null)
        if (!projectId) {
            setError("Pick a project before submitting.")
            return
        }
        startTransition(async () => {
            const reporter = readName()
            const reporter_id = readReporterId()
            const res = await fetch("/api/public-issues", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ token, project_id: projectId, reporter, reporter_id, title, body, priority }),
            })
            if (!res.ok) {
                const e = await res.json().catch(() => ({}))
                setError(e?.error?.message || `Failed (${res.status})`)
                return
            }
            const data = await res.json()
            const issue = data.issue
            if (issue?.id && issue?.issue_number) {
                setSubmitted({ id: issue.id, issue_number: issue.issue_number })
                // Refresh so the new issue lands in the server-rendered
                // "All submissions" list under the visitor's reporter
                // group when they hit "Submit another" or scroll down.
                router.refresh()
            }
        })
    }

    function reset() {
        setSubmitted(null)
        setTitle("")
        setBody("")
        setPriority("medium")
        setError(null)
    }

    if (submitted) {
        return (
            <div className="anim-rise flex flex-col gap-3 rounded-[14px] border border-emerald-200 bg-emerald-50 p-5 sm:p-6">
                <div className="flex items-center gap-2">
                    <span className="grid h-7 w-7 place-items-center rounded-full bg-emerald-600 text-white">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                            <path d="M5 12l5 5L20 7" />
                        </svg>
                    </span>
                    <div className="text-[15px] font-bold text-emerald-900">
                        Thanks — issue #{submitted.issue_number} filed.
                    </div>
                </div>
                <p className="text-[13px] leading-relaxed text-emerald-900/80">
                    The maintainers will see this on their issue board. Reference{" "}
                    <span className="font-mono font-semibold">#{submitted.issue_number}</span> if you need to follow up.
                </p>
                <div className="flex flex-wrap gap-2">
                    <Link
                        href={`/p/${token}/issues/${submitted.id}`}
                        className="btn-primary"
                    >
                        View issue & analysis
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden>
                            <path d="M5 12h14M13 5l7 7-7 7" />
                        </svg>
                    </Link>
                    <button type="button" onClick={reset} className="btn-ghost">
                        Submit another
                    </button>
                </div>
            </div>
        )
    }

    const titleOver = title.length > MAX_TITLE
    const bodyOver = body.length > MAX_BODY
    const canSubmit = !pending && title.trim().length > 0 && !titleOver && !bodyOver

    return (
        <form
            onSubmit={submit}
            className="anim-fade flex flex-col gap-3 rounded-[14px] border border-[color:var(--c-border)] bg-white p-4 shadow-sm sm:p-6"
            aria-busy={pending}
        >
            <fieldset disabled={pending} className="contents">
                {projects.length > 1 ? (
                    <label className="flex flex-col gap-1">
                        <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-[color:var(--c-text-muted)]">
                            Project
                        </span>
                        <Dropdown<string>
                            value={projectId}
                            onChange={setProjectId}
                            options={projects.map((p) => ({ value: p.id, label: p.name }))}
                            aria-label="Project"
                        />
                    </label>
                ) : projects.length === 1 ? (
                    <div className="flex items-center gap-2 text-[12px] text-[color:var(--c-text-muted)]">
                        <span className="text-[11px] font-bold uppercase tracking-[0.08em]">Project</span>
                        <span className="rounded-full bg-[color:var(--c-surface-2)] px-2 py-0.5 font-semibold text-[color:var(--c-text)]">
                            {projects[0].name}
                        </span>
                    </div>
                ) : null}

                {projectId && (
                    <div className="flex flex-wrap items-center justify-between gap-2 rounded-[10px] border border-dashed border-[color:var(--c-border)] bg-[color:var(--c-surface-2)] px-3 py-2">
                        <span className="text-[11.5px] text-[color:var(--c-text-muted)]">
                            Don&apos;t feel like writing it up? Let AI draft from your notes + screenshots.
                        </span>
                        <PublicAiComposeButton
                            token={token}
                            projectId={projectId}
                            onAccept={(p) => {
                                setTitle(p.title.slice(0, MAX_TITLE))
                                setBody(p.body.slice(0, MAX_BODY))
                                setPriority(p.priority)
                            }}
                        />
                    </div>
                )}

                <label className="flex flex-col gap-1">
                    <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-[color:var(--c-text-muted)]">
                        Title
                    </span>
                    <input
                        autoFocus
                        required
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        placeholder="What's wrong, in one line…"
                        className="input text-[14px] font-semibold"
                        aria-invalid={titleOver || undefined}
                    />
                    {titleOver && (
                        <span className="text-[11px] text-rose-700">Title is too long ({title.length}/{MAX_TITLE}).</span>
                    )}
                </label>

                <label className="flex flex-col gap-1">
                    <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-[color:var(--c-text-muted)]">
                        Details
                    </span>
                    <textarea
                        value={body}
                        onChange={(e) => setBody(e.target.value)}
                        rows={6}
                        placeholder="Steps to reproduce, what you expected, what happened (markdown supported)…"
                        className="input text-[13px] leading-relaxed"
                        aria-invalid={bodyOver || undefined}
                    />
                    <span className={`text-[11px] tabular-nums ${bodyOver ? "text-rose-700" : "text-[color:var(--c-text-dim)]"}`}>
                        {body.length.toLocaleString()} / {MAX_BODY.toLocaleString()}
                    </span>
                </label>

                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <label className="flex items-center gap-2">
                        <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-[color:var(--c-text-muted)]">
                            Priority
                        </span>
                        <Dropdown<IssuePriority>
                            value={priority}
                            onChange={setPriority}
                            options={PRIORITY_OPTIONS}
                            aria-label="Priority"
                        />
                    </label>
                    <button
                        type="submit"
                        disabled={!canSubmit}
                        className="btn-primary w-full sm:w-auto disabled:cursor-not-allowed"
                    >
                        {pending ? (
                            <>
                                <Spinner />
                                Submitting…
                            </>
                        ) : (
                            "Submit issue"
                        )}
                    </button>
                </div>
            </fieldset>

            {error && (
                <p role="alert" className="rounded-[10px] bg-rose-50 px-3 py-2 text-[12.5px] text-rose-800">
                    {error}
                </p>
            )}
        </form>
    )
}
