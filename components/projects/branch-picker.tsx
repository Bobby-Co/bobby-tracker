"use client"

import { useApi } from "@/lib/client/hooks/use-api"
import { cn } from "@/components/ui/cn"
import { Dropdown } from "@/components/ui/dropdown"
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
            <Dropdown
                value={value}
                onChange={onChange}
                options={[
                    { value: DEFAULT_BRANCH_VALUE, label: "default" },
                    ...ready.map((b) => ({ value: b.branch, label: b.branch })),
                ]}
                searchable={ready.length > 8}
                aria-label="Branch to answer from"
                // Dropdown is w-full by default, which is right for a form field
                // and wrong for an inline control sitting beside a label above
                // the composer. Bounded so it sizes to its content instead of
                // stretching the row.
                className="w-auto min-w-[9rem] max-w-[16rem]"
            />
        </label>
    )
}
