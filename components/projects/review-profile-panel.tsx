"use client"

import { useState } from "react"
import Link from "next/link"
import { cn } from "@/components/ui/cn"
import { useApi } from "@/lib/client/hooks/use-api"
import { ApiError, apiMutate } from "@/lib/client/http/api-client"
// Domain file directly, never the barrel — see the note in review-profiles-tab.
import { affectsMergeGate, matchingPreset, type ReviewProfile } from "@/modules/analysis/domain/ReviewProfile"

// Which review profile this project's PR reviews run under (0077).
//
// The list is the TEAM's, so this panel is a picker rather than an editor: the
// profile itself is edited once, on the team page, and pointed at from as many
// projects as want it. Showing the effect of the current pick here — rather than
// only its name — is what stops "Payments — strict" becoming a label nobody can
// decode six months later.
export function ReviewProfilePanel({ projectId, teamId }: { projectId: string; teamId: string | null }) {
    const assigned = useApi<{ profile: ReviewProfile | null }>(`/api/projects/${projectId}/review-profile`)
    const library = useApi<{ profiles: ReviewProfile[] }>(teamId ? `/api/teams/${teamId}/review-profiles` : null)

    const [override, setOverride] = useState<string | null | undefined>(undefined)
    const [busy, setBusy] = useState(false)
    const [err, setErr] = useState<string | null>(null)

    const profiles = library.data?.profiles ?? []
    const currentId = override !== undefined ? override : (assigned.data?.profile?.id ?? null)
    const current = profiles.find((p) => p.id === currentId) ?? null

    async function choose(next: string | null) {
        if (busy || next === currentId) return
        const previous = currentId
        setErr(null)
        setBusy(true)
        setOverride(next) // optimistic
        try {
            await apiMutate(`/api/projects/${projectId}/review-profile`, {
                method: "PUT",
                body: { profile_id: next },
            })
        } catch (e) {
            setOverride(previous)
            setErr(e instanceof ApiError ? (e.message ?? "Couldn't save") : "Network error")
        } finally {
            setBusy(false)
        }
    }

    return (
        <div className="card">
            <div className="card-title">
                <SlidersIcon />
                <span>PR review profile</span>
            </div>
            <p className="mt-1.5 text-[12.5px] text-[color:var(--c-text-muted)]">
                How Ucelot reviews pull requests in this project. Profiles are shared across the
                team — <Link href="/team?tab=reviews" className="underline">manage them here</Link>.
            </p>

            <div className="mt-4 flex flex-wrap gap-1.5">
                <button
                    type="button"
                    onClick={() => choose(null)}
                    disabled={busy}
                    className={cn(
                        "rounded-full border px-3 py-1.5 text-[12.5px] transition-colors disabled:opacity-50",
                        currentId === null
                            ? "border-[color:var(--c-primary)] bg-[color:var(--c-primary-tint)] font-semibold"
                            : "border-[color:var(--c-border)] hover:border-[color:var(--c-border-strong)]",
                    )}
                >
                    Default
                </button>
                {profiles.map((p) => (
                    <button
                        key={p.id}
                        type="button"
                        onClick={() => choose(p.id)}
                        disabled={busy}
                        className={cn(
                            "rounded-full border px-3 py-1.5 text-[12.5px] transition-colors disabled:opacity-50",
                            currentId === p.id
                                ? "border-[color:var(--c-primary)] bg-[color:var(--c-primary-tint)] font-semibold"
                                : "border-[color:var(--c-border)] hover:border-[color:var(--c-border-strong)]",
                        )}
                    >
                        {p.name}
                    </button>
                ))}
            </div>

            {/* What the current pick actually does, in this project's terms. */}
            <p className="mt-3 text-[12px] leading-5 text-[color:var(--c-text-muted)]">
                {current ? <ProfileSummary profile={current} /> : "The built-in reviewer: balanced, cites its evidence, and flags anything serious as a blocker."}
            </p>

            {current && affectsMergeGate(current.dials) && (
                <p className="mt-2 rounded-[10px] border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] leading-5 text-amber-900">
                    This profile changes what counts as a blocker, so it changes when the merge
                    button in Ucelot is held. GitHub&apos;s own checks are unaffected.
                </p>
            )}

            {profiles.length === 0 && teamId && (
                <p className="mt-3 text-[12px] text-[color:var(--c-text-dim)]">
                    Your team hasn&apos;t created any profiles yet.
                </p>
            )}
            {err && <p className="mt-3 text-[12px] text-rose-700">{err}</p>}
        </div>
    )
}

function ProfileSummary({ profile }: { profile: ReviewProfile }) {
    const preset = matchingPreset(profile.dials, profile.lenses)
    const bits = [
        preset ? preset.tagline : `${profile.dials.strictness} strictness, ${profile.dials.verbosity} detail`,
        profile.lenses.length > 0 ? `Also looks at: ${profile.lenses.join(", ").replace(/_/g, " ")}.` : null,
        profile.instructions ? "Has team instructions." : null,
    ].filter(Boolean)
    return <>{bits.join(" ")}</>
}

function SlidersIcon() {
    return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3" />
            <path d="M1 14h6M9 8h6M17 16h6" />
        </svg>
    )
}
