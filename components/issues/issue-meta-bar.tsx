"use client"

import { useRef, useState } from "react"
import { Dropdown } from "@/components/ui/dropdown"
import { cn } from "@/components/ui/cn"
import { ISSUE_PRIORITIES, ISSUE_STATUSES } from "@/lib/shared/types"
import type { ProjectBranch } from "@/lib/shared/types"
import { PRIORITY_META, STATUS_META } from "@/components/issues/issue-meta"
import { DEFAULT_BRANCH_VALUE, defaultBranchLabel } from "@/components/projects/branch-picker"
import { EFFORT_HINT, EFFORT_LABEL } from "@/components/ui/effort-control"
import { ProjectAnalyser } from "@/modules/analysis/domain/ProjectAnalyser"
import type { DraftEffort, DraftFields, DraftPriority, DraftStatus } from "@/modules/issues/domain/IssueDraft"

// The composer's metadata, as ONE row of chips.
//
// It used to be a stack: a three-column grid of full-width selects, plus a
// bordered panel for the branch, plus an accordion for effort. Four rows of
// chrome above the description, for facts that are each one word long. The
// composer is for WRITING; the metadata is a handful of small decisions beside
// it, and it should take space in proportion to that.
//
// So: pills, sized by their content, wrapping, each carrying the colour that
// already means something elsewhere in the app (the status dot, the priority
// dot). A chip that is set reads as a statement — "Open", "High", "feat/x" —
// and a chip that is not reads as a prompt.
//
// Directly under the title and above the description, because these are the
// decisions you make ABOUT the thing you are about to write — and because the
// description is the tall element, so anything below it is below the fold.

/** A coloured dot: the vocabulary the issue lists and the detail page already
 *  use for status and priority, so a chip reads the same as the row it becomes. */
function Dot({ className }: { className: string }) {
    return <span className={cn("h-2 w-2 rounded-full", className)} />
}

function BranchIcon() {
    return (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <circle cx="6" cy="5" r="2.5" />
            <circle cx="6" cy="19" r="2.5" />
            <circle cx="18" cy="9" r="2.5" />
            <path d="M6 7.5v9M18 11.5c0 3-3 4-6 4.5" />
        </svg>
    )
}

function GaugeIcon() {
    return (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M4 18a8 8 0 1 1 16 0" />
            <path d="M12 18l4.5-5" />
        </svg>
    )
}

function TagIcon() {
    return (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M20.6 13.4 12 22l-9-9V3h10l7.6 7.6a2 2 0 0 1 0 2.8Z" />
            <circle cx="7.5" cy="7.5" r="1.2" fill="currentColor" />
        </svg>
    )
}

const STATUS_OPTIONS = ISSUE_STATUSES.map((s) => ({
    value: s,
    label: STATUS_META[s].label,
    icon: <Dot className={STATUS_META[s].dot} />,
}))

const PRIORITY_OPTIONS = ISSUE_PRIORITIES.map((p) => ({
    value: p,
    label: PRIORITY_META[p].label,
    icon: <Dot className={PRIORITY_META[p].dot} />,
}))

// Effort was the sole occupant of an "Advanced settings" accordion — a whole
// disclosure widget guarding one dropdown. As a chip it costs a fifth of a row,
// and the popover carries the same per-level explanation the accordion did,
// where it is read at the moment of choosing rather than on the way past.
const EFFORT_OPTIONS: { value: DraftEffort; label: string; description: string; icon: React.ReactNode }[] = [
    {
        value: "",
        label: "Default effort",
        description: "Inherit the project's saved effort.",
        icon: <GaugeIcon />,
    },
    ...ProjectAnalyser.EFFORTS.map((level) => ({
        value: level as DraftEffort,
        label: EFFORT_LABEL[level],
        description: EFFORT_HINT[level],
        icon: <GaugeIcon />,
    })),
]

/** Matches issue-branch-choice's sentinel in spirit: a value no option carries,
 *  so the Dropdown renders its placeholder instead of a label. A single space
 *  cannot be a branch name (the shape rule rejects whitespace) and is not "",
 *  so it collides with neither a branch nor the default. */
const UNCHOSEN_VALUE = " "

export function IssueMetaBar({
    fields,
    patch,
    ready,
    defaultBranch,
    className,
}: {
    fields: DraftFields
    patch: (p: Partial<DraftFields>) => void
    /** The project's indexed branches; empty means no branch chip at all. */
    ready: ProjectBranch[]
    defaultBranch: string | null
    className?: string
}) {
    const { status, priority, labels, branch } = fields
    // The branch chip is the only REQUIRED one, and only when the project
    // actually offers a choice — see issue-branch-choice for the full rule.
    const branchPending = ready.length > 0 && branch === null

    return (
        <div className={cn("flex flex-wrap items-center gap-1.5", className)}>
            <Dropdown<DraftStatus>
                variant="chip"
                value={status}
                onChange={(v) => patch({ status: v })}
                options={STATUS_OPTIONS}
                aria-label="Status"
            />
            <Dropdown<DraftPriority>
                variant="chip"
                value={priority}
                onChange={(v) => patch({ priority: v })}
                options={PRIORITY_OPTIONS}
                aria-label="Priority"
            />

            {ready.length > 0 && (
                <Dropdown
                    variant="chip"
                    value={branch ?? UNCHOSEN_VALUE}
                    onChange={(v) => patch({ branch: v })}
                    placeholder="Pick a branch"
                    leadingIcon={<BranchIcon />}
                    options={[
                        { value: DEFAULT_BRANCH_VALUE, label: defaultBranchLabel(defaultBranch), icon: <BranchIcon /> },
                        ...ready.map((b) => ({ value: b.branch, label: b.branch, icon: <BranchIcon /> })),
                    ]}
                    searchable={ready.length > 8}
                    aria-label="Branch to analyse this issue against"
                    // Unanswered, it is the one thing on this row asking for
                    // something, so it is the one thing tinted. Answered, it
                    // goes quiet and looks like its neighbours.
                    triggerClassName={cn(
                        branchPending &&
                            "border-[color:var(--c-primary)] bg-[color:var(--c-primary-tint)]",
                    )}
                />
            )}

            {/* Last, because it is the only OPEN-ENDED one: the fixed chips are
                each one word and pack predictably, while labels grow with
                whatever the author adds. Trailing, they wrap onto their own line
                instead of pushing a select onto the next one. */}
            <LabelChips value={labels} onChange={(v) => patch({ labels: v })} />
        </div>
    )
}

/** The analyser-effort chip, deliberately NOT part of the metadata row.
 *
 *  Everything on that row describes the ISSUE — what state it is in, how urgent
 *  it is, which tree it is about, what it is tagged with. Effort describes the
 *  RUN that happens after you press Create: how hard the analyser should work,
 *  and therefore how long it takes and what it costs. That is a property of the
 *  action, not of the thing, so it belongs beside the action — where it reads as
 *  "when I create this, investigate it like so" rather than as a fifth fact
 *  about the issue. */
export function IssueEffortChip({
    value,
    onChange,
    className,
}: {
    value: DraftEffort
    onChange: (effort: DraftEffort) => void
    className?: string
}) {
    return (
        <Dropdown<DraftEffort>
            variant="chip"
            value={value}
            onChange={onChange}
            options={EFFORT_OPTIONS}
            aria-label="Analyser effort"
            className={className}
        />
    )
}

// Labels as chips rather than a comma-separated text box.
//
// The STORED shape stays a comma-separated string — what the draft persists and
// what the POST sends — so this is presentation only: split on the way in, join
// on the way out. Which also means a draft written before this existed re-opens
// with its labels intact, as chips.
function LabelChips({ value, onChange }: { value: string; onChange: (v: string) => void }) {
    const [adding, setAdding] = useState(false)
    const [draft, setDraft] = useState("")
    const inputRef = useRef<HTMLInputElement>(null)

    const labels = value.split(",").map((l) => l.trim()).filter(Boolean)

    function commit() {
        const next = draft.trim().replace(/,/g, "")
        // A duplicate is dropped silently rather than refused: the user's intent
        // ("this issue has this label") is already satisfied.
        if (next && !labels.includes(next)) onChange([...labels, next].join(", "))
        setDraft("")
        setAdding(false)
    }

    return (
        <>
            {labels.map((l) => (
                <span
                    key={l}
                    className="inline-flex items-center gap-1 rounded-full border border-[color:var(--c-border)] bg-[color:var(--c-surface)] py-[5px] pl-2 pr-1.5 text-[12px] font-medium text-[color:var(--c-text)]"
                >
                    <span className="text-[color:var(--c-text-muted)]"><TagIcon /></span>
                    <span className="max-w-[10rem] truncate">{l}</span>
                    <button
                        type="button"
                        onClick={() => onChange(labels.filter((x) => x !== l).join(", "))}
                        aria-label={`Remove label ${l}`}
                        className="grid h-4 w-4 place-items-center rounded-full text-[color:var(--c-text-dim)] transition-colors hover:bg-[color:var(--c-overlay)] hover:text-[color:var(--c-text)]"
                    >
                        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden>
                            <path d="M6 6l12 12M18 6L6 18" />
                        </svg>
                    </button>
                </span>
            ))}

            {adding ? (
                <input
                    ref={inputRef}
                    autoFocus
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onBlur={commit}
                    onKeyDown={(e) => {
                        // Enter AND comma both commit — comma because the text
                        // box this replaces trained everyone to type it, and it
                        // must not end up inside a label name.
                        if (e.key === "Enter" || e.key === ",") {
                            e.preventDefault()
                            commit()
                        } else if (e.key === "Escape") {
                            e.preventDefault()
                            setDraft("")
                            setAdding(false)
                        } else if (e.key === "Backspace" && !draft && labels.length) {
                            // Backspace on an empty box eats the previous chip,
                            // the behaviour every tag input has.
                            onChange(labels.slice(0, -1).join(", "))
                        }
                    }}
                    placeholder="label"
                    aria-label="Add a label"
                    className="w-24 rounded-full border border-[color:var(--c-border-strong)] bg-[color:var(--c-surface)] px-2.5 py-[5px] text-[12px] text-[color:var(--c-text)] outline-none placeholder:text-[color:var(--c-text-dim)]"
                />
            ) : (
                <button
                    type="button"
                    onClick={() => setAdding(true)}
                    className="inline-flex items-center gap-1 rounded-full border border-dashed border-[color:var(--c-border-strong)] py-[5px] pl-2 pr-2.5 text-[12px] font-medium text-[color:var(--c-text-muted)] transition-colors hover:border-[color:var(--c-text-dim)] hover:text-[color:var(--c-text)]"
                >
                    <TagIcon />
                    {labels.length ? "Label" : "Add label"}
                </button>
            )}
        </>
    )
}
