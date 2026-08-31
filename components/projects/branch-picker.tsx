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

/** What an indexed-tree control needs: the branches that can actually answer a
 *  question, and what the default one is CALLED.
 *
 *  Only `ready` branches: one mid-index cannot answer, and the analyser refuses
 *  it outright rather than falling back to the default — so offering it would
 *  hand the user a choice that produces an error.
 *
 *  `defaultBranch` is null when the name has not been learned yet (0095), which
 *  is not an error and is what every project looked like before it was
 *  mirrored. Callers fall back to the generic word. */
export function useReadyBranches(projectId: string): { ready: ProjectBranch[]; defaultBranch: string | null } {
    const { data } = useApi<{ branches: ProjectBranch[]; default_branch: string | null }>(
        `/api/projects/${projectId}/branches`,
    )
    return {
        ready: (data?.branches ?? []).filter((b) => b.status === "ready"),
        defaultBranch: data?.default_branch ?? null,
    }
}

/** How the default tree is spelled in a picker: by NAME when we know it, since
 *  "Default branch" beside "feat/x" asks someone to choose between a named
 *  thing and an unnamed one — on a repo whose default might be main, master,
 *  develop or trunk. The word stays, because "main" alone does not say that it
 *  IS the default. */
export function defaultBranchLabel(defaultBranch: string | null): string {
    return defaultBranch ? `Default branch (${defaultBranch})` : "Default branch"
}

/** The options an indexed-tree control offers: the default, then every ready
 *  branch. Kept next to the picker so both surfaces spell "default" the same. */
export function branchOptions(ready: ProjectBranch[], defaultBranch: string | null): { value: string; label: string }[] {
    return [
        { value: DEFAULT_BRANCH_VALUE, label: defaultBranchLabel(defaultBranch) },
        ...ready.map((b) => ({ value: b.branch, label: b.branch })),
    ]
}

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
    const { ready, defaultBranch } = useReadyBranches(projectId)
    if (ready.length === 0) return null

    return (
        <label className={cn("flex items-center gap-1.5 text-[12px]", className)}>
            <span className="text-[color:var(--c-text-muted)]">Branch</span>
            <Dropdown
                value={value}
                onChange={onChange}
                options={branchOptions(ready, defaultBranch)}
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
