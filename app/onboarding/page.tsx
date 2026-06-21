"use client"

import { Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { useAuth } from "@/lib/auth/auth-context"
import { isAllowed } from "@/lib/auth/access"
import { AuthShell } from "@/components/auth-shell"

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

const ONBOARDING_HEADLINE = "You're in. Welcome to Ucelot."
const ONBOARDING_SUBTEXT =
    "Just two quick steps and you'll be tracking issues that point straight to the code."

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
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState<string | null>(null)

    // Route guards (UX only — RLS is the real boundary). Anonymous visitors
    // go sign in; anyone already onboarded skips straight to the app.
    useEffect(() => {
        if (loading) return
        if (!user) {
            router.replace(`/login?next=${encodeURIComponent("/onboarding")}`)
            return
        }
        // Not on the beta whitelist → coming-soon page, not onboarding.
        if (!isAllowed(user)) {
            router.replace("/waitlist")
            return
        }
        if (user.user_metadata?.onboarded) router.replace(next)
    }, [loading, user, next, router])

    // Animate the panel height to the active step so the card grows/shrinks
    // smoothly between steps instead of always reserving the taller step's
    // height (which left a dead gap on step 1). The button glides with it.
    const step0Ref = useRef<HTMLDivElement>(null)
    const step1Ref = useRef<HTMLDivElement>(null)
    const [trackH, setTrackH] = useState<number | undefined>(undefined)
    useLayoutEffect(() => {
        const el = step === 0 ? step0Ref.current : step1Ref.current
        if (el) setTrackH(el.offsetHeight)
    }, [step])
    useEffect(() => {
        const measure = () => {
            const el = step === 0 ? step0Ref.current : step1Ref.current
            if (el) setTrackH(el.offsetHeight)
        }
        window.addEventListener("resize", measure)
        return () => window.removeEventListener("resize", measure)
    }, [step])

    const canContinue = name.trim().length > 0 && isEmail(email)
    const canFinish = !!role && !!size && !saving

    async function finish() {
        setSaving(true)
        setError(null)
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
        router.replace(next)
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
                    <span className="h-1 flex-1 rounded-full bg-zinc-900 transition-colors duration-300" />
                    <span
                        className={`h-1 flex-1 rounded-full transition-colors duration-300 ${
                            step >= 1 ? "bg-zinc-900" : "bg-[color:var(--c-border)]"
                        }`}
                    />
                </div>
                <span className="text-[11px] font-semibold tabular-nums text-[color:var(--c-text-dim)]">
                    {step + 1}/2
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
                    <section
                        ref={step0Ref}
                        aria-hidden={step !== 0}
                        className={`w-full shrink-0 px-1 transition-opacity duration-300 ${
                            step === 0 ? "opacity-100" : "opacity-0"
                        }`}
                    >
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
                    </section>

                    {/* Step 2 — about your work */}
                    <section
                        ref={step1Ref}
                        aria-hidden={step !== 1}
                        className={`w-full shrink-0 px-1 transition-opacity duration-300 ${
                            step === 1 ? "opacity-100" : "opacity-0"
                        }`}
                    >
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
                    </section>
                </div>
            </div>

            {/* Actions */}
            {step === 0 ? (
                <button
                    onClick={() => setStep(1)}
                    disabled={!canContinue}
                    className="btn-primary mt-7 w-full py-3 text-[14px]"
                >
                    Continue
                </button>
            ) : (
                <div className="mt-7 flex gap-2.5">
                    <button
                        onClick={() => setStep(0)}
                        disabled={saving}
                        className="btn-ghost px-5 py-3 text-[14px]"
                    >
                        Back
                    </button>
                    <button onClick={finish} disabled={!canFinish} className="btn-primary flex-1 py-3 text-[14px]">
                        {saving ? "Saving…" : "Finish"}
                    </button>
                </div>
            )}

            {error && (
                <p className="mt-4 rounded-[10px] bg-rose-50 px-3 py-2 text-[12.5px] text-rose-800">{error}</p>
            )}
        </AuthShell>
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
            </div>
            <div className="mt-7 h-6 w-2/3 rounded bg-[color:var(--c-surface-2)]" />
            <div className="mt-3 h-4 w-1/2 rounded bg-[color:var(--c-surface-2)]" />
            <div className="mt-7 h-10 w-full rounded-[12px] bg-[color:var(--c-surface-2)]" />
            <div className="mt-4 h-10 w-full rounded-[12px] bg-[color:var(--c-surface-2)]" />
            <div className="mt-7 h-11 w-full rounded-[10px] bg-[color:var(--c-surface-2)]" />
        </div>
    )
}
