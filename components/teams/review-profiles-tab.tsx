"use client"

import { useState } from "react"
import { cn } from "@/components/ui/cn"
import { useApi } from "@/lib/client/hooks/use-api"
import { ApiError, apiMutate } from "@/lib/client/http/api-client"
// Imported from the DOMAIN files directly, not the module barrel. The barrel
// re-exports Composition → infrastructure → lib/server/supabase → next/headers,
// which pulls the server into the browser bundle and fails at build time rather
// than at typecheck. Domain files import nothing, which is what makes this safe.
import {
    DEFAULT_DIALS,
    DIAL_SPECS,
    LENSES,
    PRESETS,
    affectsMergeGate,
    matchingPreset,
    type Dials,
    type ReviewProfile,
} from "@/modules/analysis/domain/ReviewProfile"
import { LIMITS, instructionsRemaining } from "@/modules/analysis/domain/ReviewInstructions"
import type { TeamWithRole } from "@/lib/shared/types"

// The team's PR-reviewer profiles (0077).
//
// The thing this screen has to get right is that a dial's EFFECT is legible
// before you save it. A settings page full of words like "thorough" and
// "strict" teaches nobody anything: what people need to know is "this caps the
// review at 5 findings" and "this changes what blocks a merge". So every option
// carries its effect, and the two dials that reach the merge gate say so out
// loud rather than being one row among seven.

interface Draft {
    id: string | null
    name: string
    preset: string | null
    dials: Dials
    lenses: string[]
    instructions: string
    pathRules: { glob: string; text: string }[]
}

function draftFrom(p: ReviewProfile): Draft {
    return {
        id: p.id,
        name: p.name,
        preset: p.preset,
        dials: p.dials,
        lenses: [...p.lenses],
        instructions: p.instructions,
        pathRules: p.path_rules.map((r) => ({ ...r })),
    }
}

function blankDraft(): Draft {
    const balanced = PRESETS[0]
    return {
        id: null,
        name: "",
        preset: balanced.key,
        dials: { ...balanced.dials },
        lenses: [...balanced.lenses],
        instructions: "",
        pathRules: [],
    }
}

export function ReviewProfilesTab({ team, isAdmin }: { team: TeamWithRole; isAdmin: boolean }) {
    const { data, refetch } = useApi<{ profiles: ReviewProfile[] }>(`/api/teams/${team.id}/review-profiles`)
    const profiles = data?.profiles ?? []
    const [draft, setDraft] = useState<Draft | null>(null)

    if (draft) {
        return (
            <ProfileEditor
                teamId={team.id}
                draft={draft}
                setDraft={setDraft}
                onDone={() => {
                    setDraft(null)
                    refetch()
                }}
            />
        )
    }

    return (
        <div className="flex flex-col gap-4">
            <div className="card">
                <div className="card-title">
                    <SlidersIcon />
                    <span>Review profiles</span>
                    <span className="ml-auto" />
                    {isAdmin && (
                        <button type="button" onClick={() => setDraft(blankDraft())} className="btn-ghost px-3 py-1.5 text-[12px]">
                            New profile
                        </button>
                    )}
                </div>
                <p className="mt-1.5 text-[12.5px] text-[color:var(--c-text-muted)]">
                    How Ucelot reviews pull requests: what it looks for, how much it says, and what
                    it treats as a blocker. Profiles belong to the team; each project picks one on
                    its own settings page. A project with no profile uses the built-in default.
                </p>

                {profiles.length === 0 ? (
                    <p className="mt-4 rounded-[12px] border border-dashed border-[color:var(--c-border)] px-4 py-6 text-center text-[13px] text-[color:var(--c-text-muted)]">
                        No profiles yet — every project reviews with the default.
                    </p>
                ) : (
                    <ul className="mt-4 flex flex-col gap-2">
                        {profiles.map((p) => {
                            const preset = matchingPreset(p.dials, p.lenses)
                            return (
                                <li
                                    key={p.id}
                                    className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-[10px] border border-[color:var(--c-border)] bg-[color:var(--c-surface-2)] px-3 py-2.5"
                                >
                                    <span className="text-[13px] font-semibold">{p.name}</span>
                                    <span className="text-[11.5px] text-[color:var(--c-text-muted)]">
                                        {preset ? preset.label : "Custom"}
                                        {p.lenses.length > 0 && ` · ${p.lenses.length} extra ${p.lenses.length === 1 ? "lens" : "lenses"}`}
                                        {p.instructions && " · has instructions"}
                                    </span>
                                    {affectsMergeGate(p.dials) && (
                                        <span className="rounded-full bg-amber-50 px-2 py-[1px] text-[10.5px] font-semibold text-amber-700">
                                            changes merge blocking
                                        </span>
                                    )}
                                    {isAdmin && (
                                        <button
                                            type="button"
                                            onClick={() => setDraft(draftFrom(p))}
                                            className="btn-ghost ml-auto px-2.5 py-1 text-[12px]"
                                        >
                                            Edit
                                        </button>
                                    )}
                                </li>
                            )
                        })}
                    </ul>
                )}
            </div>
        </div>
    )
}

function ProfileEditor({
    teamId,
    draft,
    setDraft,
    onDone,
}: {
    teamId: string
    draft: Draft
    setDraft: (d: Draft | null) => void
    onDone: () => void
}) {
    const [busy, setBusy] = useState(false)
    const [err, setErr] = useState<string | null>(null)
    const [notes, setNotes] = useState<string[]>([])

    const set = (patch: Partial<Draft>) => setDraft({ ...draft, ...patch })
    const preset = matchingPreset(draft.dials, draft.lenses)
    const remaining = instructionsRemaining(draft.instructions)

    async function save() {
        if (busy) return
        setBusy(true)
        setErr(null)
        setNotes([])
        try {
            const body = {
                name: draft.name,
                preset: preset?.key ?? null,
                dials: draft.dials,
                lenses: draft.lenses,
                instructions: draft.instructions,
                path_rules: draft.pathRules,
            }
            const res = await apiMutate<{ issues?: { message: string }[] }>(
                draft.id
                    ? `/api/teams/${teamId}/review-profiles/${draft.id}`
                    : `/api/teams/${teamId}/review-profiles`,
                { method: draft.id ? "PATCH" : "POST", body },
            )
            // Show what the server changed on the way in, rather than letting a
            // stripped character become a mystery later.
            if (res?.issues?.length) {
                setNotes(res.issues.map((i) => i.message))
                setBusy(false)
                return
            }
            onDone()
        } catch (e) {
            setErr(e instanceof ApiError ? (e.message ?? "Couldn't save") : "Network error")
            setBusy(false)
        }
    }

    async function remove() {
        if (busy || !draft.id) return
        setBusy(true)
        try {
            await apiMutate(`/api/teams/${teamId}/review-profiles/${draft.id}`, { method: "DELETE" })
            onDone()
        } catch (e) {
            setErr(e instanceof ApiError ? (e.message ?? "Couldn't delete") : "Network error")
            setBusy(false)
        }
    }

    return (
        <div className="flex flex-col gap-4">
            <div className="card">
                <div className="card-title">
                    <SlidersIcon />
                    <span>{draft.id ? "Edit profile" : "New profile"}</span>
                    <span className="ml-auto" />
                    <button type="button" onClick={() => setDraft(null)} className="btn-ghost px-3 py-1.5 text-[12px]">
                        Cancel
                    </button>
                    <button
                        type="button"
                        onClick={save}
                        disabled={busy || !draft.name.trim()}
                        className="btn-primary px-3 py-1.5 text-[12px] disabled:opacity-50"
                    >
                        {busy ? "Saving…" : "Save"}
                    </button>
                </div>

                <label className="mt-4 block">
                    <span className="text-[12px] font-semibold text-[color:var(--c-text-muted)]">Name</span>
                    <input
                        value={draft.name}
                        onChange={(e) => set({ name: e.target.value })}
                        maxLength={60}
                        placeholder="e.g. Payments — strict"
                        className="mt-1 w-full max-w-sm rounded-[8px] border border-[color:var(--c-border)] bg-[color:var(--c-surface)] px-2.5 py-1.5 text-[13px]"
                    />
                </label>

                <h4 className="mt-6 text-[12px] font-bold uppercase tracking-[0.04em] text-[color:var(--c-text-muted)]">
                    Start from
                </h4>
                <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {PRESETS.map((p) => (
                        <button
                            key={p.key}
                            type="button"
                            onClick={() => set({ dials: { ...p.dials }, lenses: [...p.lenses], preset: p.key })}
                            className={cn(
                                "rounded-[10px] border px-3 py-2.5 text-left transition-colors",
                                preset?.key === p.key
                                    ? "border-[color:var(--c-primary)] bg-[color:var(--c-primary-tint)]"
                                    : "border-[color:var(--c-border)] bg-[color:var(--c-surface-2)] hover:border-[color:var(--c-border-strong)]",
                            )}
                        >
                            <span className="block text-[13px] font-semibold">{p.label}</span>
                            <span className="mt-0.5 block text-[11.5px] leading-4 text-[color:var(--c-text-muted)]">{p.tagline}</span>
                        </button>
                    ))}
                </div>
                {!preset && (
                    <p className="mt-2 text-[11.5px] text-[color:var(--c-text-muted)]">
                        Custom — you&apos;ve changed something since picking a preset.
                    </p>
                )}

                <h4 className="mt-6 text-[12px] font-bold uppercase tracking-[0.04em] text-[color:var(--c-text-muted)]">
                    Dials
                </h4>
                <div className="mt-2 flex flex-col gap-4">
                    {DIAL_SPECS.map((spec) => {
                        const current = draft.dials[spec.key]
                        const option = spec.options.find((o) => o.value === current)
                        return (
                            <div key={spec.key}>
                                <div className="flex flex-wrap items-baseline gap-2">
                                    <span className="text-[12.5px] font-semibold">{spec.label}</span>
                                    {spec.affectsMerge && (
                                        <span className="rounded-full bg-amber-50 px-2 py-[1px] text-[10px] font-semibold text-amber-700">
                                            affects merging
                                        </span>
                                    )}
                                </div>
                                <p className="mt-0.5 text-[11.5px] leading-4 text-[color:var(--c-text-muted)]">{spec.help}</p>
                                <div className="mt-1.5 flex flex-wrap gap-1.5">
                                    {spec.options.map((o) => (
                                        <button
                                            key={o.value}
                                            type="button"
                                            onClick={() => set({ dials: { ...draft.dials, [spec.key]: o.value } })}
                                            className={cn(
                                                "rounded-full border px-2.5 py-1 text-[12px] transition-colors",
                                                current === o.value
                                                    ? "border-[color:var(--c-primary)] bg-[color:var(--c-primary-tint)] font-semibold"
                                                    : "border-[color:var(--c-border)] hover:border-[color:var(--c-border-strong)]",
                                            )}
                                        >
                                            {o.label}
                                        </button>
                                    ))}
                                </div>
                                {/* The effect of the CURRENT choice, always visible. A settings
                                    page that only shows the word is one nobody learns from. */}
                                {option && (
                                    <p className="mt-1 text-[11.5px] leading-4 text-[color:var(--c-text-dim)]">{option.effect}</p>
                                )}
                            </div>
                        )
                    })}
                </div>

                {affectsMergeGate(draft.dials) && (
                    <p className="mt-4 rounded-[10px] border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] leading-5 text-amber-900">
                        This profile changes what Ucelot treats as a blocker, and the merge button in
                        Ucelot is held while blockers exist. Projects using it may become easier or
                        harder to merge. GitHub&apos;s own checks are unaffected.
                    </p>
                )}

                <h4 className="mt-6 text-[12px] font-bold uppercase tracking-[0.04em] text-[color:var(--c-text-muted)]">
                    What it looks at
                </h4>
                <div className="mt-2 flex flex-wrap gap-1.5">
                    {LENSES.map((l) => {
                        const on = l.alwaysOn || draft.lenses.includes(l.key)
                        return (
                            <button
                                key={l.key}
                                type="button"
                                disabled={l.alwaysOn}
                                title={l.alwaysOn ? `${l.help} Always on.` : l.help}
                                onClick={() =>
                                    set({
                                        lenses: draft.lenses.includes(l.key)
                                            ? draft.lenses.filter((k) => k !== l.key)
                                            : [...draft.lenses, l.key],
                                    })
                                }
                                className={cn(
                                    "rounded-full border px-2.5 py-1 text-[12px] transition-colors",
                                    on
                                        ? "border-[color:var(--c-primary)] bg-[color:var(--c-primary-tint)] font-semibold"
                                        : "border-[color:var(--c-border)] hover:border-[color:var(--c-border-strong)]",
                                    l.alwaysOn && "cursor-default opacity-70",
                                )}
                            >
                                {l.label}
                                {l.alwaysOn && " ·"}
                            </button>
                        )
                    })}
                </div>
                {/* Said plainly rather than hidden. The three run whatever the profile
                    says, so a switch offering to turn them off would be a switch that
                    visibly does nothing. */}
                <p className="mt-1.5 text-[11.5px] text-[color:var(--c-text-dim)]">
                    Correctness, blast radius and test gaps always run — they&apos;re the checks Ucelot
                    enforces itself, so turning them off wouldn&apos;t change the review.
                </p>

                <h4 className="mt-6 text-[12px] font-bold uppercase tracking-[0.04em] text-[color:var(--c-text-muted)]">
                    Instructions
                </h4>
                <p className="mt-0.5 text-[11.5px] leading-4 text-[color:var(--c-text-muted)]">
                    Anything specific to this codebase — a convention, a thing that keeps biting you.
                    Ucelot treats this as a preference about what to look for, not as an instruction
                    it must obey: it can&apos;t switch off the evidence Ucelot cites or change its verdict.
                </p>
                <textarea
                    value={draft.instructions}
                    onChange={(e) => set({ instructions: e.target.value.slice(0, LIMITS.instructions) })}
                    rows={4}
                    placeholder="We wrap errors with %w. Flag anything writing to the cache without a TTL."
                    className="mt-1.5 w-full rounded-[8px] border border-[color:var(--c-border)] bg-[color:var(--c-surface)] px-2.5 py-2 text-[13px] leading-5"
                />
                <p className={cn("mt-1 text-[11px]", remaining < 100 ? "text-amber-700" : "text-[color:var(--c-text-dim)]")}>
                    {remaining} characters left
                </p>

                <div className="mt-4 flex items-center justify-between gap-2">
                    <h4 className="text-[12px] font-bold uppercase tracking-[0.04em] text-[color:var(--c-text-muted)]">
                        Per-path rules
                    </h4>
                    <button
                        type="button"
                        onClick={() => set({ pathRules: [...draft.pathRules, { glob: "", text: "" }] })}
                        disabled={draft.pathRules.length >= LIMITS.rules}
                        className="btn-ghost px-2.5 py-1 text-[12px] disabled:opacity-50"
                    >
                        Add rule
                    </button>
                </div>
                <p className="text-[11.5px] leading-4 text-[color:var(--c-text-muted)]">
                    Only applied when a pull request actually touches a matching file.
                </p>
                <div className="mt-2 flex flex-col gap-2">
                    {draft.pathRules.map((r, i) => (
                        <div key={i} className="flex flex-wrap items-center gap-2">
                            <input
                                value={r.glob}
                                onChange={(e) =>
                                    set({ pathRules: draft.pathRules.map((x, j) => (j === i ? { ...x, glob: e.target.value } : x)) })
                                }
                                placeholder="supabase/migrations/*.sql"
                                className="w-full max-w-[240px] rounded-[8px] border border-[color:var(--c-border)] bg-[color:var(--c-surface)] px-2.5 py-1.5 font-mono text-[12px]"
                            />
                            <input
                                value={r.text}
                                onChange={(e) =>
                                    set({ pathRules: draft.pathRules.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)) })
                                }
                                maxLength={LIMITS.ruleText}
                                placeholder="every migration needs a rollback note"
                                className="min-w-[200px] flex-1 rounded-[8px] border border-[color:var(--c-border)] bg-[color:var(--c-surface)] px-2.5 py-1.5 text-[12.5px]"
                            />
                            <button
                                type="button"
                                onClick={() => set({ pathRules: draft.pathRules.filter((_, j) => j !== i) })}
                                className="btn-ghost px-2 py-1 text-[12px]"
                                aria-label="Remove rule"
                            >
                                ✕
                            </button>
                        </div>
                    ))}
                </div>

                {notes.length > 0 && (
                    <ul className="mt-4 flex flex-col gap-1 rounded-[10px] border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-900">
                        {notes.map((n, i) => (
                            <li key={i}>{n}</li>
                        ))}
                        <li className="font-semibold">Review the changes above, then save again.</li>
                    </ul>
                )}
                {err && <p className="mt-3 text-[12px] text-rose-700">{err}</p>}

                {draft.id && (
                    <div className="mt-6 border-t border-[color:var(--c-border)] pt-4">
                        <button type="button" onClick={remove} disabled={busy} className="btn-ghost px-3 py-1.5 text-[12px] text-rose-700">
                            Delete this profile
                        </button>
                        <p className="mt-1 text-[11.5px] text-[color:var(--c-text-muted)]">
                            Projects using it go back to the default reviewer. Nothing else changes.
                        </p>
                    </div>
                )}
            </div>
        </div>
    )
}

function SlidersIcon() {
    return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3" />
            <path d="M1 14h6M9 8h6M17 16h6" />
        </svg>
    )
}
