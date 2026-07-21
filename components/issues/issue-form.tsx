"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { ISSUE_PRIORITIES, ISSUE_STATUSES } from "@/lib/supabase/types"
import type { IssuePriority, IssueStatus } from "@/lib/supabase/types"
import { ProjectAnalyser, type AnalyseEffort } from "@/modules/analysis/domain/project-analyser"
import { EFFORT_LABEL, EFFORT_HINT } from "@/components/ui/effort-control"
import { Dropdown } from "@/components/ui/dropdown"
import { cn } from "@/components/ui/cn"
import { ApiError, apiMutate } from "@/lib/platform/http/api-client"

const STATUS_OPTIONS = ISSUE_STATUSES.map((s) => ({ value: s, label: s.replace(/_/g, " ") }))
const PRIORITY_OPTIONS = ISSUE_PRIORITIES.map((p) => ({ value: p, label: p }))

// "" = inherit the project default. The 4 levels mirror AnalyseEffort.
type EffortChoice = "" | AnalyseEffort
const EFFORT_OPTIONS: { value: EffortChoice; label: string; description: string }[] = [
    { value: "", label: "Use project default", description: "Inherit the project's saved effort." },
    ...ProjectAnalyser.EFFORTS.map((level) => ({
        value: level,
        label: EFFORT_LABEL[level],
        description: EFFORT_HINT[level],
    })),
]

interface IssueFormProps {
    projectId: string
    onSuccess?: () => void
    onCancel?: () => void
}

// Controlled form for creating an issue. The owner (modal wrapper, inline
// page section, etc.) supplies projectId and optional onSuccess /
// onCancel callbacks. The form does NOT manage its own open/close state.
export function IssueForm({ projectId, onSuccess, onCancel }: IssueFormProps) {
    const router = useRouter()
    const [title, setTitle] = useState("")
    const [body, setBody] = useState("")
    const [status, setStatus] = useState<IssueStatus>("open")
    const [priority, setPriority] = useState<IssuePriority>("medium")
    const [labels, setLabels] = useState("")
    const [effort, setEffort] = useState<EffortChoice>("")
    const [advanced, setAdvanced] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [pending, startTransition] = useTransition()

    function submit(e: React.FormEvent) {
        e.preventDefault()
        setError(null)
        startTransition(async () => {
            try {
                const { issue } = await apiMutate<{ issue?: { id?: string } }>("/api/issues", {
                    method: "POST",
                    body: {
                        project_id: projectId,
                        title,
                        body,
                        status,
                        priority,
                        labels: labels.split(",").map((l) => l.trim()).filter(Boolean),
                        // Omit when "" so the issue inherits the project default.
                        analyse_effort: effort || undefined,
                    },
                })
                onSuccess?.()
                // Land on the new issue's detail page so the suggestions panel
                // can auto-trigger investigation. Refresh the issues list too
                // so when the user navigates back it's already up to date.
                router.refresh()
                if (issue?.id) router.push(`/projects/${projectId}/issues/${issue.id}`)
            } catch (e) {
                if (!(e instanceof ApiError)) throw e
                setError(e.message || `Failed (${e.status})`)
            }
        })
    }

    return (
        <form onSubmit={submit} className="flex flex-col gap-3">
            <input
                autoFocus
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Issue title…"
                className="input text-[14px] font-semibold"
            />
            <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={5}
                placeholder="Describe what's happening (markdown supported)…"
                className="input text-[13px]"
            />
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                <Dropdown<IssueStatus>
                    value={status}
                    onChange={setStatus}
                    options={STATUS_OPTIONS}
                    aria-label="Status"
                />
                <Dropdown<IssuePriority>
                    value={priority}
                    onChange={setPriority}
                    options={PRIORITY_OPTIONS}
                    aria-label="Priority"
                />
                <input
                    value={labels}
                    onChange={(e) => setLabels(e.target.value)}
                    placeholder="bug, performance"
                    className="input"
                />
            </div>

            <div className="rounded-[10px] border border-[color:var(--c-border)]">
                <button
                    type="button"
                    onClick={() => setAdvanced((v) => !v)}
                    aria-expanded={advanced}
                    className="flex w-full items-center gap-1.5 px-3 py-2 text-[12px] font-semibold text-[color:var(--c-text-muted)] transition-colors hover:text-[color:var(--c-text)]"
                >
                    <svg
                        width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                        strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden
                        className={cn("transition-transform duration-200", advanced && "rotate-90")}
                    >
                        <path d="M9 6l6 6-6 6" />
                    </svg>
                    Advanced settings
                </button>
                {advanced && (
                    <div className="border-t border-[color:var(--c-border)] p-3">
                        <label className="text-[11px] font-bold uppercase tracking-[0.10em] text-[color:var(--c-text-dim)]">
                            Analyser effort
                        </label>
                        <div className="mt-1.5">
                            <Dropdown<EffortChoice>
                                value={effort}
                                onChange={setEffort}
                                options={EFFORT_OPTIONS}
                                aria-label="Analyser effort"
                            />
                        </div>
                        <p className="mt-2 text-[11.5px] leading-4 text-[color:var(--c-text-muted)]">
                            {effort === ""
                                ? "Inherits this project's saved default. Higher effort makes the analyser dig deeper for a richer, more accurate analysis — slower and pricier."
                                : EFFORT_HINT[effort]}
                        </p>
                    </div>
                )}
            </div>

            {error && <p className="text-[12px] text-rose-700">{error}</p>}
            <div className="mt-1 flex justify-end gap-2">
                {onCancel && (
                    <button type="button" onClick={onCancel} className="btn-ghost">
                        Cancel
                    </button>
                )}
                <button type="submit" disabled={pending || !title.trim()} className="btn-primary">
                    {pending ? "Saving…" : "Create issue"}
                </button>
            </div>
        </form>
    )
}
