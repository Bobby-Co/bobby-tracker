"use client"

import { Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { createClient } from "@/lib/client/supabase"
import { useAuth } from "@/lib/client/auth/auth-context"
import { setActiveTeamCookie } from "@/lib/client/auth/team-context"
import { useApi } from "@/lib/client/hooks/use-api"
import { ApiError, apiMutate } from "@/lib/client/http/api-client"
import { BetaAccess } from "@/lib/shared/BetaAccess"
import { AuthShell } from "@/components/layout/auth-shell"
import { RegionMap, type RegionOption } from "@/components/teams/region-map"

const ROLES = [
    "Engineer",
    "Engineering lead",
    "Product manager",
    "Founder / exec",
    "Designer",
    "Other",
]

const COMPANY_SIZES = ["Just me", "2–10", "11–50", "51–200", "200+"]

const isEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim())

/** "Ada Lovelace" → "Ada's Team". A seed, not a decision — the field stays
 *  editable, and an empty name just leaves the user to type their own. */
function seedTeamName(fullName: string): string {
    const first = fullName.trim().split(/\s+/)[0] ?? ""
    return first ? `${first}'s Team` : ""
}

const STEP_COUNT = 3

const ONBOARDING_HEADLINE = "You're in. Welcome to Ucelot."
const ONBOARDING_SUBTEXT =
    "Three quick steps and you'll be tracking issues that point straight to the code."

export default function OnboardingPage() {
    return (
        <Suspense
            fallback={
                <AuthShell headline={ONBOARDING_HEADLINE} subtext={ONBOARDING_SUBTEXT} contentClassName="max-w-[400px]">
                    <OnboardingSkeleton />
                </AuthShell>
            }
        >
            <OnboardingInner />
        </Suspense>
    )
}

function OnboardingInner() {
    const router = useRouter()
    const params = useSearchParams()
    // Only honor same-origin relative paths (mirrors the callback guard).
    const rawNext = params.get("next")
    const next = rawNext && rawNext.startsWith("/") && !rawNext.startsWith("//") ? rawNext : "/projects"

    const { user, loading } = useAuth()
    const supabase = useMemo(() => createClient(), [])

    const [step, setStep] = useState(0)
    // Name/email are seeded from the OAuth identity but stay user-editable. We
    // derive the displayed value during render (edit ?? seed) rather than
    // syncing through an effect — no setState-in-effect cascade, and the fields
    // populate the instant the session resolves.
    const md = (user?.user_metadata ?? {}) as Record<string, unknown>
    const seededName = (md.full_name as string) || (md.name as string) || ""
    const seededEmail = user?.email || (md.email as string) || ""
    const [nameEdit, setNameEdit] = useState<string | null>(null)
    const [emailEdit, setEmailEdit] = useState<string | null>(null)
    const name = nameEdit ?? seededName
    const email = emailEdit ?? seededEmail
    const [role, setRole] = useState<string | null>(null)
    const [size, setSize] = useState<string | null>(null)
    // Same derive-don't-sync trick: the team name follows whatever they typed on
    // step 1 until they edit it themselves.
    const [teamNameEdit, setTeamNameEdit] = useState<string | null>(null)
    const teamName = teamNameEdit ?? seedTeamName(name)
    const [pickedRegion, setPickedRegion] = useState("")
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState<string | null>(null)

    // Where a team can actually be placed. Regions with no analyser behind them
    // are not returned at all, so a single-region deployment yields one option —
    // and, as in the create-team modal, no picker: a map with one pin asks the
    // user to confirm something they have no choice about.
    const regionsQ = useApi<{ regions: RegionOption[] }>(user ? "/api/regions" : null)
    const regions = useMemo(() => regionsQ.data?.regions ?? [], [regionsQ.data])
    // Derived, not synced: until they pick, the first region IS the selection, so
    // the map always shows what will be submitted.
    const region = pickedRegion || regions[0]?.id || ""

    // The team, once created. Held so a failure AFTER creation (the metadata
    // write below) doesn't create a second team when they press Finish again.
    const createdTeamId = useRef<string | null>(null)

    // Route guards (UX only — RLS is the real boundary). Anonymous visitors
    // go sign in; anyone already onboarded skips straight to the app.
    useEffect(() => {
        if (loading) return
        if (!user) {
            router.replace(`/login?next=${encodeURIComponent("/onboarding")}`)
            return
        }
        // Everyone onboards — even users who aren't on the beta whitelist yet.
        // Already-onboarded users skip straight through: to the app if they're
        // allowed, otherwise to the coming-soon waitlist.
        if (user.user_metadata?.onboarded) {
            router.replace(new BetaAccess().isAllowed(user) ? next : "/waitlist")
        }
    }, [loading, user, next, router])

    // Animate the panel height to the active step so the card grows/shrinks
    // smoothly between steps instead of always reserving the tallest step's
    // height (which left a dead gap on the shorter ones). The button glides with
    // it. Measured per step, so adding a fourth needs no changes here.
    const stepRefs = useRef<(HTMLDivElement | null)[]>([])
    const [trackH, setTrackH] = useState<number | undefined>(undefined)
    useLayoutEffect(() => {
        const el = stepRefs.current[step]
        if (el) setTrackH(el.offsetHeight)
        // The region map arrives with the /api/regions response, which lands
        // after the first measure — so re-measure when the step's content can
        // still change height under it.
    }, [step, regions.length])
    useEffect(() => {
        const measure = () => {
            const el = stepRefs.current[step]
            if (el) setTrackH(el.offsetHeight)
        }
        window.addEventListener("resize", measure)
        return () => window.removeEventListener("resize", measure)
    }, [step])

    const canAdvance =
        step === 0
            ? name.trim().length > 0 && isEmail(email)
            : step === 1
              ? !!role && !!size
              : teamName.trim().length > 0
    const canFinish = canAdvance && !saving

    async function finish() {
        setSaving(true)
        setError(null)

        // The team comes FIRST, and this is the one ordering that matters. It is
        // the user's whole workspace — projects, members, billing, and the region
        // every repository is served from — so if it can't be created there is
        // nothing to be onboarded INTO. Marking them onboarded first would drop
        // them into an app with no team, where the next request silently
        // bootstraps a personal one at the home region: exactly the placement
        // they were just asked about, chosen for them, unnoticed.
        if (!createdTeamId.current) {
            try {
                const body = await apiMutate<{ team?: { id?: string } }>("/api/teams", {
                    method: "POST",
                    // Region omitted when there's nothing to choose — the server
                    // then places the team at home, the only available answer.
                    body: { name: teamName.trim(), ...(region ? { region } : {}) },
                })
                createdTeamId.current = body?.team?.id ?? null
            } catch (e) {
                setError(e instanceof ApiError ? e.message : "Couldn't create your team. Try again.")
                setSaving(false)
                return
            }
        }

        // Make it active before we leave. The app shell reads this cookie to pick
        // the team; without it a user who somehow has a personal team as well
        // would land in that one instead of the workspace they just named.
        if (createdTeamId.current) setActiveTeamCookie(createdTeamId.current)

        const { error } = await supabase.auth.updateUser({
            data: {
                full_name: name.trim(),
                contact_email: email.trim(),
                role,
                company_size: size,
                onboarded: true,
            },
        })
        if (error) {
            setError(error.message)
            setSaving(false)
            return
        }
        // Onboarded — hand off to where they were headed if they're on the
        // whitelist, otherwise to the coming-soon waitlist.
        router.replace(new BetaAccess().isAllowed(user) ? next : "/waitlist")
    }

    // Resolving the session or mid-redirect — keep the shell, swap a skeleton
    // in for the form so the gradient panel never flashes.
    if (loading || !user || user.user_metadata?.onboarded) {
        return (
            <AuthShell headline={ONBOARDING_HEADLINE} subtext={ONBOARDING_SUBTEXT} contentClassName="max-w-[400px]">
                <OnboardingSkeleton />
            </AuthShell>
        )
    }

    return (
        <AuthShell headline={ONBOARDING_HEADLINE} subtext={ONBOARDING_SUBTEXT} contentClassName="max-w-[400px]">
            {/* Progress */}
            <div className="flex items-center gap-3">
                <div className="flex flex-1 gap-1.5">
                    {Array.from({ length: STEP_COUNT }, (_, i) => (
                        <span
                            key={i}
                            className={`h-1 flex-1 rounded-full transition-colors duration-300 ${
                                step >= i ? "bg-zinc-900" : "bg-[color:var(--c-border)]"
                            }`}
                        />
                    ))}
                </div>
                <span className="text-[11px] font-semibold tabular-nums text-[color:var(--c-text-dim)]">
                    {step + 1}/{STEP_COUNT}
                </span>
            </div>

            {/* Sliding step track */}
            <div
                className="mt-6 overflow-hidden transition-[height] duration-[420ms] ease-[cubic-bezier(0.22,1,0.36,1)]"
                style={{ height: trackH }}
            >
                <div
                    className="flex items-start transition-transform duration-[420ms] ease-[cubic-bezier(0.22,1,0.36,1)]"
                    style={{ transform: `translateX(-${step * 100}%)` }}
                >
                    {/* Step 1 — who you are */}
                    <Step index={0} step={step} register={(el) => { stepRefs.current[0] = el }}>
                        <h1 className="text-[24px] font-extrabold tracking-[-0.02em]">Let&apos;s get you set up</h1>
                        <p className="mt-2 text-[13.5px] leading-6 text-[color:var(--c-text-muted)]">
                            Tell us a little about you.
                        </p>
                        <div className="mt-6 space-y-4">
                            <div>
                                <label htmlFor="ob-name" className="mb-1.5 block text-[12.5px] font-semibold">
                                    Name
                                </label>
                                <input
                                    id="ob-name"
                                    className="input"
                                    placeholder="Your name"
                                    value={name}
                                    onChange={(e) => setNameEdit(e.target.value)}
                                    autoComplete="name"
                                />
                            </div>
                            <div>
                                <label htmlFor="ob-email" className="mb-1.5 block text-[12.5px] font-semibold">
                                    Email
                                </label>
                                <input
                                    id="ob-email"
                                    type="email"
                                    className="input"
                                    placeholder="you@company.com"
                                    value={email}
                                    onChange={(e) => setEmailEdit(e.target.value)}
                                    autoComplete="email"
                                />
                                <p className="mt-1.5 text-[11.5px] text-[color:var(--c-text-dim)]">
                                    We&apos;ll send important updates here.
                                </p>
                            </div>
                        </div>
                    </Step>

                    {/* Step 2 — about your work */}
                    <Step index={1} step={step} register={(el) => { stepRefs.current[1] = el }}>
                        <h1 className="text-[24px] font-extrabold tracking-[-0.02em]">A bit about your work</h1>
                        <p className="mt-2 text-[13.5px] leading-6 text-[color:var(--c-text-muted)]">
                            This helps us tailor Ucelot to you.
                        </p>
                        <div className="mt-6">
                            <p className="mb-2 text-[12.5px] font-semibold">What&apos;s your role?</p>
                            <div className="grid grid-cols-2 gap-2">
                                {ROLES.map((r) => (
                                    <Chip key={r} selected={role === r} onClick={() => setRole(r)}>
                                        {r}
                                    </Chip>
                                ))}
                            </div>
                        </div>
                        <div className="mt-5">
                            <p className="mb-2 text-[12.5px] font-semibold">How big is your company?</p>
                            <div className="grid grid-cols-3 gap-2">
                                {COMPANY_SIZES.map((s) => (
                                    <Chip key={s} selected={size === s} onClick={() => setSize(s)}>
                                        {s}
                                    </Chip>
                                ))}
                            </div>
                        </div>
                    </Step>

                    {/* Step 3 — the workspace itself: what it's called, and where
                        it lives. Placement is asked HERE because this is the last
                        moment it is free: a team's region is fixed once it owns
                        repositories, since moving it means re-indexing all of
                        them. Before this step it was decided by a default nobody
                        saw. */}
                    <Step index={2} step={step} register={(el) => { stepRefs.current[2] = el }}>
                        <h1 className="text-[24px] font-extrabold tracking-[-0.02em]">Your workspace</h1>
                        <p className="mt-2 text-[13.5px] leading-6 text-[color:var(--c-text-muted)]">
                            Projects, teammates and billing all live in a team.
                        </p>
                        <div className="mt-6 space-y-4">
                            <div>
                                <label htmlFor="ob-team" className="mb-1.5 block text-[12.5px] font-semibold">
                                    Team name
                                </label>
                                <input
                                    id="ob-team"
                                    className="input"
                                    placeholder="Acme Engineering"
                                    value={teamName}
                                    onChange={(e) => setTeamNameEdit(e.target.value)}
                                />
                                <p className="mt-1.5 text-[11.5px] text-[color:var(--c-text-dim)]">
                                    You can rename it later, and add more teams whenever you like.
                                </p>
                            </div>

                            {regions.length > 1 && (
                                <div>
                                    <p className="mb-1.5 text-[12.5px] font-semibold">Region</p>
                                    <RegionMap
                                        regions={regions}
                                        value={region}
                                        onChange={setPickedRegion}
                                        disabled={saving}
                                    />
                                    <p className="mt-1.5 text-[11.5px] leading-snug text-[color:var(--c-text-dim)]">
                                        Where this team&rsquo;s code is stored and analysed. Unlike the name, this
                                        one is permanent — moving a team means re-indexing every repository it owns.
                                    </p>
                                </div>
                            )}
                        </div>
                    </Step>
                </div>
            </div>

            {/* Actions */}
            {step < STEP_COUNT - 1 ? (
                <div className="mt-7 flex gap-2.5">
                    {step > 0 && (
                        <button onClick={() => setStep(step - 1)} className="btn-ghost px-5 py-3 text-[14px]">
                            Back
                        </button>
                    )}
                    <button
                        onClick={() => setStep(step + 1)}
                        disabled={!canAdvance}
                        className="btn-primary flex-1 py-3 text-[14px]"
                    >
                        Continue
                    </button>
                </div>
            ) : (
                <div className="mt-7 flex gap-2.5">
                    <button
                        onClick={() => setStep(step - 1)}
                        disabled={saving}
                        className="btn-ghost px-5 py-3 text-[14px]"
                    >
                        Back
                    </button>
                    <button onClick={finish} disabled={!canFinish} className="btn-primary flex-1 py-3 text-[14px]">
                        {saving ? "Creating…" : "Finish"}
                    </button>
                </div>
            )}

            {error && (
                <p className="mt-4 rounded-[10px] bg-rose-50 px-3 py-2 text-[12.5px] text-rose-800">{error}</p>
            )}
        </AuthShell>
    )
}

/** One panel in the sliding track. Hands its node back through `register` so the
 *  container can measure whichever step is active — the ref array belongs to the
 *  parent, which is the only thing that reads it. */
function Step({
    index,
    step,
    register,
    children,
}: {
    index: number
    step: number
    register: (el: HTMLDivElement | null) => void
    children: React.ReactNode
}) {
    return (
        <section
            ref={register}
            aria-hidden={step !== index}
            className={`w-full shrink-0 px-1 transition-opacity duration-300 ${
                step === index ? "opacity-100" : "opacity-0"
            }`}
        >
            {children}
        </section>
    )
}

function Chip({
    selected,
    onClick,
    children,
}: {
    selected: boolean
    onClick: () => void
    children: React.ReactNode
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            aria-pressed={selected}
            className={`rounded-[10px] border px-3 py-2.5 text-[13px] font-medium transition ${
                selected
                    ? "border-zinc-900 bg-zinc-900 text-white"
                    : "border-[color:var(--c-border)] bg-white text-[color:var(--c-text)] hover:border-[color:var(--c-border-strong)] hover:bg-[color:var(--c-surface-2)]"
            }`}
        >
            {children}
        </button>
    )
}

function OnboardingSkeleton() {
    return (
        <div className="animate-pulse">
            <div className="flex gap-1.5">
                <span className="h-1 flex-1 rounded-full bg-[color:var(--c-border)]" />
                <span className="h-1 flex-1 rounded-full bg-[color:var(--c-border)]" />
                <span className="h-1 flex-1 rounded-full bg-[color:var(--c-border)]" />
            </div>
            <div className="mt-7 h-6 w-2/3 rounded bg-[color:var(--c-surface-2)]" />
            <div className="mt-3 h-4 w-1/2 rounded bg-[color:var(--c-surface-2)]" />
            <div className="mt-7 h-10 w-full rounded-[12px] bg-[color:var(--c-surface-2)]" />
            <div className="mt-4 h-10 w-full rounded-[12px] bg-[color:var(--c-surface-2)]" />
            <div className="mt-7 h-11 w-full rounded-[10px] bg-[color:var(--c-surface-2)]" />
        </div>
    )
}
