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

/** What "unchosen" is handed to the Dropdown as.
 *
 *  The Dropdown shows its `placeholder` when the value matches NO option, which
 *  is exactly the rendering we want — but the obvious way to get there, adding a
 *  "Choose a branch…" option with an empty value, collides with the default
 *  branch's own empty value. Two options with the same value are two children
 *  with the same React key, and the list silently drops one of them.
 *
 *  A NUL is the sentinel because a git ref cannot contain one, so it can never
 *  collide with a real branch, and it is not "" so it cannot collide with the
 *  default either. */
const UNCHOSEN_VALUE = "\u0000"

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
        // ONE border class, chosen — not two with the strong one appended.
        // `cn` is a plain joiner with no tailwind-merge, so emitting both leaves
        // the winner to stylesheet order rather than to this condition.
        //
        // A surface of its own, because a bordered box with a transparent
        // background reads as a hole punched in the panel on the dark theme
        // rather than as a raised field group. surface-2 and NOT surface: the
        // Dropdown's own trigger is surface, so matching it would dissolve the
        // control into its container.
        <div
            className={cn(
                "rounded-[10px] border bg-[color:var(--c-surface-2)] p-3",
                pending ? "border-[color:var(--c-border-strong)]" : "border-[color:var(--c-border)]",
                className,
            )}
        >
            <label className="text-[11px] font-bold uppercase tracking-[0.10em] text-[color:var(--c-text-dim)]">
                {/* The themed error token, not a raw Tailwind rose: rose-600 is
                    a deep red that all but disappears against the dark theme's
                    near-black navy. */}
                Analyse against <span className="text-[color:var(--c-error)]">*</span>
            </label>
            <div className="mt-1.5">
                <Dropdown
                    value={value ?? UNCHOSEN_VALUE}
                    onChange={onChange}
                    placeholder="Choose a branch…"
                    options={[
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
