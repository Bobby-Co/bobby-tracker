"use client"

import { Dropdown } from "@/components/ui/dropdown"
import { cn } from "@/components/ui/cn"
import { DEFAULT_BRANCH_VALUE } from "@/components/projects/branch-picker"
import type { ProjectBranch } from "@/lib/shared/types"

// Which tree an issue gets investigated against — asked at composition time,
// as a first-class field rather than an advanced setting.
//
// It belongs here because it decides what the analysis READS. An issue about
// `feat/x` investigated against trunk is answered from files that branch may
// have moved, renamed or deleted, and the result reads as a confident, ordinary
// analysis — there is nothing in it to tell you it looked at the wrong tree.
// Buried under "Advanced settings" it would be found by the people who already
// knew, which is the wrong half.
//
// ─── Why the choice is required, but only sometimes ─────────────────────────
//
// There is no pre-selected value: a default here is a decision made silently on
// the author's behalf, and the whole point is that the decision matters. So the
// composer will not submit until the author picks — including picking "the
// default branch", which is a legitimate answer, just not an assumed one.
//
// But a project that tracks NO branches has exactly one tree. There is no
// choice to make, nothing the author could learn by being asked, and a
// mandatory field with a single option is a click that teaches nothing. So the
// control renders nothing at all, and the issue goes to the default tree as it
// always has. `branchChoicePending` encodes the same rule for the submit gate,
// so the two can't disagree.

/** The unchosen state. Distinct from `DEFAULT_BRANCH_VALUE` (""), which is the
 *  author having explicitly ANSWERED "the default branch" — the difference
 *  between "not asked yet" and "asked and answered". */
export const BRANCH_UNCHOSEN = null

/** Whether the composer is still waiting on this decision. True only when the
 *  project offers a real choice and the author hasn't made it. */
export function branchChoicePending(ready: ProjectBranch[], value: string | null): boolean {
    return ready.length > 0 && value === null
}

export function IssueBranchChoice({
    ready,
    value,
    onChange,
    className,
}: {
    /** The project's indexed branches. Fetched by the OWNER, not here: useApi
     *  does no dedup, so a hook in this component would double every request
     *  the submit gate already makes. */
    ready: ProjectBranch[]
    value: string | null
    onChange: (branch: string) => void
    className?: string
}) {
    if (ready.length === 0) return null
    const pending = value === null

    return (
        <div className={cn("rounded-[10px] border border-[color:var(--c-border)] p-3", pending && "border-[color:var(--c-border-strong)]", className)}>
            <label className="text-[11px] font-bold uppercase tracking-[0.10em] text-[color:var(--c-text-dim)]">
                Analyse against <span className="text-rose-600">*</span>
            </label>
            <div className="mt-1.5">
                <Dropdown
                    value={value ?? ""}
                    onChange={onChange}
                    options={[
                        // The placeholder is an OPTION rather than a separate
                        // empty state so the control has a stable size and the
                        // author can see there is something to answer.
                        ...(pending ? [{ value: "", label: "Choose a branch…" }] : []),
                        { value: DEFAULT_BRANCH_VALUE, label: "Default branch" },
                        ...ready.map((b) => ({ value: b.branch, label: b.branch })),
                    ]}
                    searchable={ready.length > 8}
                    aria-label="Branch to analyse this issue against"
                />
            </div>
            <p className="mt-2 text-[11.5px] leading-4 text-[color:var(--c-text-muted)]">
                {pending
                    ? "Pick the branch this issue is about. The investigation reads that branch's code — on the wrong one, it cites lines that have since moved."
                    : "You can change this later from the issue; the next investigation will re-run against the new branch."}
            </p>
        </div>
    )
}
