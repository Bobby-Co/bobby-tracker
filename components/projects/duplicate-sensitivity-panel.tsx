"use client"

import { useState } from "react"
import { cn } from "@/components/ui/cn"
import { useApi } from "@/lib/client/hooks/use-api"
import { ApiError, apiMutate } from "@/lib/client/http/api-client"
import {
    DEFAULT_DUPLICATE_SENSITIVITY,
    DUPLICATE_SENSITIVITIES,
    SENSITIVITY_COPY,
    parseDuplicateSensitivity,
    type DuplicateSensitivity,
// Imported from the domain file DIRECTLY, not the module barrel. The barrel
// re-exports Composition, which reaches infrastructure, which imports
// lib/server/supabase and therefore next/headers — pulling all of that into the
// browser bundle and failing at build time, not typecheck. Domain files are
// dependency-free by construction, which is what makes this safe.
} from "@/modules/issues/domain/DuplicateSensitivity"

// DuplicateSensitivityPanel — how eagerly this project flags one issue as a
// likely duplicate of another (0072).
//
// Presented as four named levels rather than a number, because the number is
// meaningless to the person choosing: a cosine of 0.8 says nothing on its own,
// and the right value genuinely differs per project (terse templated bug reports
// cluster far more tightly than long prose). The stored value is the NAME; the
// thresholds live in the domain so they can be retuned without a migration.
//
// The levels read in the natural direction — more sensitivity, more matches —
// which is the INVERSE of the underlying threshold. Nothing here shows the
// threshold, so that inversion never reaches the user; the loose levels carry an
// explicit warning instead.
export function DuplicateSensitivityPanel({ projectId }: { projectId: string }) {
    const { data } = useApi<{ project: { duplicate_sensitivity: string | null } | null }>(
        `/api/projects/${projectId}`,
    )
    const [override, setOverride] = useState<DuplicateSensitivity | null>(null)
    const stored = data ? parseDuplicateSensitivity(data.project?.duplicate_sensitivity) : null
    const level = override ?? stored
    const [busy, setBusy] = useState(false)
    const [err, setErr] = useState<string | null>(null)

    async function choose(next: DuplicateSensitivity) {
        if (busy || next === level) return
        const previous = level
        setErr(null)
        setBusy(true)
        setOverride(next) // optimistic
        try {
            await apiMutate(`/api/projects/${projectId}`, {
                method: "PATCH",
                body: { duplicate_sensitivity: next },
            })
        } catch (e) {
            setOverride(previous ?? DEFAULT_DUPLICATE_SENSITIVITY) // revert
            setErr(e instanceof ApiError ? (e.message ?? "Couldn't save") : "Network error")
        } finally {
            setBusy(false)
        }
    }

    const caution = level ? SENSITIVITY_COPY[level].caution : null

    return (
        <div className="rounded-[16px] border border-[color:var(--c-border)] bg-[color:var(--c-surface)] p-5">
            <div className="flex items-start gap-2.5">
                <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-[10px] bg-[color:var(--c-surface-2)] text-[color:var(--c-text-muted)]">
                    <CopyIcon />
                </span>
                <div className="min-w-0 flex-1">
                    <div className="text-[14px] font-bold">Duplicate detection</div>
                    <p className="mt-1 max-w-prose text-[13px] text-[color:var(--c-text-muted)]">
                        How similar two issues must be before this project flags one as a likely duplicate of
                        the other.
                    </p>

                    <div className="mt-3 flex flex-wrap gap-1.5" role="radiogroup" aria-label="Duplicate sensitivity">
                        {DUPLICATE_SENSITIVITIES.map((option) => {
                            const active = level === option
                            return (
                                <button
                                    key={option}
                                    type="button"
                                    role="radio"
                                    aria-checked={active}
                                    disabled={busy || level === null}
                                    onClick={() => choose(option)}
                                    className={cn(
                                        "h-8 rounded-[8px] border px-3 text-[12.5px] font-semibold transition-colors disabled:opacity-50",
                                        // --c-primary, not --c-accent. The accent
                                        // moves UP the ramp on dark so it stays
                                        // legible as TEXT, which makes it far too
                                        // pale to sit behind a white label; the
                                        // fill token holds a mid stop precisely
                                        // because a label sits on it. The dark
                                        // label inverts to ink, matching
                                        // .btn-primary's rule in globals.css.
                                        active
                                            ? "border-[color:var(--c-primary)] bg-[color:var(--c-primary)] text-white dark:text-[#1a1206]"
                                            : "border-[color:var(--c-border)] text-[color:var(--c-text-muted)] hover:text-[color:var(--c-text)]",
                                    )}
                                >
                                    {SENSITIVITY_COPY[option].label}
                                </button>
                            )
                        })}
                    </div>

                    {level && (
                        <p className="mt-2.5 text-[12.5px] text-[color:var(--c-text-muted)]">
                            {SENSITIVITY_COPY[level].detail}
                        </p>
                    )}

                    {/* The warning the loose levels exist to carry. Amber rather
                        than red: this is a deliberate trade the user is making,
                        not a mistake they need to undo. */}
                    {caution && (
                        <p className="mt-2 rounded-[8px] border border-amber-300 bg-amber-50/60 px-2.5 py-1.5 text-[12px] text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/25 dark:text-amber-400">
                            {caution}
                        </p>
                    )}

                    {err && <p className="mt-2 text-[12px] text-rose-700 dark:text-rose-400">{err}</p>}
                </div>
            </div>
        </div>
    )
}

function CopyIcon() {
    return (
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <rect x="9" y="9" width="12" height="12" rx="2" />
            <path d="M5 15V5a2 2 0 0 1 2-2h10" />
        </svg>
    )
}
