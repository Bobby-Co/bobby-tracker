"use client"

import { useApi } from "@/lib/client/hooks/use-api"
import { cn } from "@/components/ui/cn"
import type { ProjectBranch } from "@/lib/shared/types"

// BranchPicker — which indexed tree a question is answered from.
//
// Renders NOTHING when a project has no ready branches, which is every project
// until someone tracks one. A control offering a single choice is worse than no
// control: it takes space to say "the only option is the one you already have".
//
// Only `ready` branches are offered. A branch mid-index cannot answer, and the
// analyser refuses it outright rather than falling back to the default — so
// listing it would hand the user a choice that produces an error.

/** The default branch is not a row in project_branches; it is the project's own
 *  graph. The picker represents it as an absent value, which is exactly what the
 *  API expects — no branch means the default one. */
export const DEFAULT_BRANCH_VALUE = ""

export function BranchPicker({
    projectId,
    value,
    onChange,
    className,
}: {
    projectId: string
    value: string
    onChange: (branch: string) => void
    className?: string
}) {
    const { data } = useApi<{ branches: ProjectBranch[] }>(`/api/projects/${projectId}/branches`)
    const ready = (data?.branches ?? []).filter((b) => b.status === "ready")
    if (ready.length === 0) return null

    return (
        <label className={cn("flex items-center gap-1.5 text-[12px]", className)}>
            <span className="text-[color:var(--c-text-muted)]">Branch</span>
            <select
                value={value}
                onChange={(e) => onChange(e.target.value)}
                className="cursor-pointer rounded-[8px] border border-[color:var(--c-border)] bg-[color:var(--c-surface)] px-2 py-1 font-mono text-[12px] outline-none focus:border-[color:var(--c-primary)]"
            >
                <option value={DEFAULT_BRANCH_VALUE}>default</option>
                {ready.map((b) => (
                    <option key={b.id} value={b.branch}>
                        {b.branch}
                    </option>
                ))}
            </select>
        </label>
    )
}
