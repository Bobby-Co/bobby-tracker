"use client"

import { useState } from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { cn } from "@/components/ui/cn"
import { useApi } from "@/lib/client/hooks/use-api"
import { apiMutate } from "@/lib/client/http/api-client"
import { useTeam } from "@/lib/client/auth/team-context"

interface TierSpec {
    id: string
    name: string
    tagline: string
    monthlyPoints: number | null
    priceUsd: number | null
    seats: number | null
    features: string[]
}
interface BillingData {
    role: string
    balance: { plan: string; tier: string; remaining: number | null }
    hasBillingAccount: boolean
    tiers: TierSpec[]
}

/** What an upgrade costs once unused credits are valued. Quoted by the server;
 *  never computed here, because the number it produces is money off an invoice. */
interface Quote {
    listCents: number
    discountCents: number
    dueCents: number
    creditsApplied: number
}

function fmtPoints(n: number): string {
    const v = Math.max(0, Math.round(n))
    if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`
    if (v >= 10_000) return `${(v / 1_000).toFixed(1).replace(/\.0$/, "")}k`
    return v.toLocaleString("en-US")
}

function money(cents: number): string {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100)
}

/** When this subscription will renew: one month from today.
 *
 *  The full price is charged now and the period runs from the purchase date, so
 *  there is no proration to explain — the date is simply today, next month.
 *  Clamped by Date itself: buying on the 31st renews on the 1st or 2nd, which is
 *  what Stripe does too. */
function renewsOn(now = new Date()): string {
    const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, now.getUTCDate()))
    return next.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })
}

export function CheckoutPanel() {
    const params = useSearchParams()
    const requested = params.get("tier")
    const canceled = params.get("canceled") === "1"
    const { activeTeam } = useTeam()
    const path = activeTeam ? `/api/billing?t=${activeTeam.id}` : "/api/billing"
    const { data, error, loading } = useApi<BillingData>(path)

    // A team with a subscription is MOVING one; a team without is buying. The two
    // are priced differently — a move values the credits left on the old plan —
    // so they are different endpoints, not one with a flag.
    const isChange = !!data && data.hasBillingAccount && data.balance.plan !== "kit"

    // Quoted by the SERVER, never computed here: the number is money off an
    // invoice, and a client that could name its own discount is a free-money
    // endpoint. Null path while it does not apply, so no request is made.
    // Called before any early return — this is a hook, and hooks are not
    // conditional.
    const quotePath =
        isChange && requested
            ? `/api/billing/upgrade?tier=${requested}${activeTeam ? `&t=${activeTeam.id}` : ""}`
            : null
    const { data: quoted } = useApi<{ quote: Quote }>(quotePath)
    const quote = quoted?.quote ?? null

    const [busy, setBusy] = useState(false)
    const [failure, setFailure] = useState<string | null>(null)

    if (loading && !data) return <CheckoutSkeleton />
    if (error) return <Centered><Notice tone="error">Couldn’t load plans: {error}</Notice></Centered>
    if (!data) return null

    const tier = data.tiers.find((t) => t.id === requested)
    if (!tier) {
        return (
            <Centered>
                <Notice tone="error">That plan doesn’t exist. <BackLink /></Notice>
            </Centered>
        )
    }
    if (tier.priceUsd === null) {
        return (
            <Centered>
                <Notice tone="error">{tier.name} is sold through our team. <BackLink /></Notice>
            </Centered>
        )
    }
    if (data.balance.plan === tier.id) {
        return (
            <Centered>
                <Notice tone="muted">You’re already on {tier.name}. <BackLink /></Notice>
            </Centered>
        )
    }

    const canManage = data.role === "owner" || data.role === "admin"

    const start = async () => {
        setBusy(true)
        setFailure(null)
        try {
            if (isChange) {
                await apiMutate("/api/billing/upgrade", { method: "POST", body: { tier: tier.id } })
                // No redirect: the card is already on file, so the change is done.
                // Back to billing, where the webhook's effect will show up.
                window.location.assign("/settings/billing?changed=1")
                return
            }
            const { url } = await apiMutate<{ url: string }>("/api/billing/checkout", {
                method: "POST",
                body: { tier: tier.id },
            })
            // A full navigation, not a router push: the destination is Stripe.
            window.location.assign(url)
        } catch (e) {
            setFailure((e as { message?: string }).message ?? "Couldn’t change the plan")
            setBusy(false)
        }
    }

    return (
        // One vertical rhythm for the whole page: siblings are spaced by the
        // parent's gap rather than each carrying its own margin. Scattered mt-*
        // values were why this drifted out of alignment — a margin belongs to
        // whichever element happens to be above, and there is no single place to
        // adjust the spacing.
        <section className="mx-auto flex w-full max-w-[520px] flex-col gap-5">
            <header className="flex flex-col gap-1.5">
                <BackLink />
                <h2 className="text-[21px] font-bold tracking-[-0.012em]">
                    {isChange ? `Switch to ${tier.name}` : `Subscribe to ${tier.name}`}
                </h2>
                <p className="text-[13px] leading-relaxed text-[color:var(--c-text-muted)]">
                    {isChange
                        ? "The unused part of your current month comes off today’s charge, and a fresh month starts now."
                        : "Review what you’re getting before you enter a card."}
                </p>
            </header>

            {canceled && <Notice tone="muted">Checkout was cancelled — nothing has been charged.</Notice>}

            {/* ── what you get ─────────────────────────────────────────────── */}
            <article className="flex flex-col gap-4 rounded-[14px] border border-[color:var(--c-border)] bg-[color:var(--c-surface)] p-5">
                <div className="flex items-start justify-between gap-4">
                    <div className="flex flex-col gap-0.5">
                        <h3 className="text-[17px] font-extrabold leading-none tracking-[-0.012em]">{tier.name}</h3>
                        <p className="text-[12.5px] text-[color:var(--c-text-muted)]">{tier.tagline}</p>
                    </div>
                    <div className="flex shrink-0 items-baseline gap-1">
                        <span className="text-[26px] font-extrabold leading-none tracking-[-0.02em] tabular-nums">
                            ${tier.priceUsd}
                        </span>
                        <span className="text-[12px] font-semibold text-[color:var(--c-text-dim)]">/mo</span>
                    </div>
                </div>

                {/* The credits are the product, so they get their own emphasis
                    rather than being the first bullet in a list. */}
                <p className="rounded-[10px] bg-[color:var(--c-primary-tint)] px-3 py-2.5 text-[13px] font-bold text-[color:var(--c-primary)]">
                    {tier.monthlyPoints === null
                        ? "Unlimited credits"
                        : `${fmtPoints(tier.monthlyPoints)} credits every month`}
                </p>

                <ul className="flex flex-col gap-2">
                    {tier.features.map((f) => (
                        <li key={f} className="flex items-start gap-2 text-[12.5px] leading-snug text-[color:var(--c-text-muted)]">
                            <CheckMark />
                            <span>{f}</span>
                        </li>
                    ))}
                </ul>
            </article>

            {/* ── what you pay ─────────────────────────────────────────────── */}
            <section className="flex flex-col gap-3 rounded-[14px] border border-[color:var(--c-border)] bg-[color:var(--c-surface)] p-5">
                <h3 className="text-[10.5px] font-bold uppercase tracking-[0.09em] text-[color:var(--c-text-dim)]">
                    Order summary
                </h3>

                <dl className="flex flex-col gap-2 text-[13px]">
                    <Row label={`${tier.name}, one month`} value={money(Math.round(tier.priceUsd * 100))} />
                    {quote && quote.discountCents > 0 && (
                        <Row
                            label={`Unused this month (${fmtPoints(quote.creditsApplied)} credits)`}
                            value={`−${money(quote.discountCents)}`}
                            tone="credit"
                        />
                    )}
                </dl>

                <div className="flex items-baseline justify-between gap-4 border-t border-[color:var(--c-border)] pt-3">
                    <dt className="text-[13px] font-bold">Due today</dt>
                    <dd className="text-[20px] font-extrabold tracking-[-0.015em] tabular-nums">
                        {money(quote ? quote.dueCents : Math.round(tier.priceUsd * 100))}
                    </dd>
                </div>

                <p className="text-[11.5px] leading-relaxed text-[color:var(--c-text-dim)]">
                    Then <span className="font-semibold text-[color:var(--c-text-muted)]">${tier.priceUsd}.00</span> on{" "}
                    {renewsOn()} and monthly after that. Credits are granted for each month you’re billed and don’t
                    roll over. Cancel any time from Usage &amp; Billing.
                </p>
            </section>

            {failure && <Notice tone="error">{failure}</Notice>}

            {/* ── the commitment ───────────────────────────────────────────── */}
            <div className="flex flex-col gap-2">
                <button
                    type="button"
                    onClick={start}
                    disabled={busy || !canManage}
                    title={!canManage ? "Only a team owner or admin can change the plan" : undefined}
                    className={cn(
                        "w-full rounded-[11px] bg-[color:var(--c-primary)] px-4 py-3 text-[13.5px] font-bold text-white",
                        "transition-colors hover:bg-[color:var(--c-primary-hover)]",
                        "disabled:cursor-not-allowed disabled:opacity-50",
                    )}
                >
                    {busy
                        ? isChange
                            ? "Changing plan…"
                            : "Opening secure checkout…"
                        : isChange
                          ? `Switch for ${money(quote ? quote.dueCents : Math.round(tier.priceUsd * 100))}`
                          : "Continue to payment"}
                </button>
                <p className="text-center text-[11.5px] text-[color:var(--c-text-dim)]">
                    {isChange
                        ? "Charged to the card already on file."
                        : "Payment is handled by Stripe. Your card details never reach our servers."}
                </p>
            </div>
        </section>
    )
}

/** One line of the order summary. A component rather than repeated markup so the
 *  label and the figure cannot drift apart in alignment or weight. */
function Row({ label, value, tone }: { label: string; value: string; tone?: "credit" }) {
    return (
        <div className="flex items-baseline justify-between gap-4">
            <dt className="text-[color:var(--c-text-muted)]">{label}</dt>
            <dd
                className={cn(
                    "font-semibold tabular-nums",
                    tone === "credit" ? "text-[color:var(--c-success)]" : "text-[color:var(--c-text)]",
                )}
            >
                {value}
            </dd>
        </div>
    )
}

function CheckMark() {
    return (
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden className="mt-[3px] shrink-0 text-[color:var(--c-success)]">
            <path d="M13 4.5 6.5 11 3 7.5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    )
}

/** Every state of this page sits in the same column, so switching between them
 *  does not shift the content sideways. */
function Centered({ children }: { children: React.ReactNode }) {
    return <div className="mx-auto w-full max-w-[520px]">{children}</div>
}

/** The loaded page's structure with the values blanked — not an approximation.
 *  Two cards, the same widths and radii, so nothing reflows when data lands. */
function CheckoutSkeleton() {
    return (
        <div className="mx-auto flex w-full max-w-[520px] animate-pulse flex-col gap-5">
            <div className="flex flex-col gap-2">
                <div className="h-3 w-16 rounded bg-[color:var(--c-surface-2)]" />
                <div className="h-6 w-56 rounded bg-[color:var(--c-surface-2)]" />
            </div>
            <div className="h-[236px] rounded-[14px] border border-[color:var(--c-border)] bg-[color:var(--c-surface-2)]" />
            <div className="h-[150px] rounded-[14px] border border-[color:var(--c-border)] bg-[color:var(--c-surface-2)]" />
            <div className="h-[46px] rounded-[11px] bg-[color:var(--c-surface-2)]" />
        </div>
    )
}

function BackLink() {
    return (
        <Link
            href="/billing/plans"
            className="inline-flex items-center gap-1 text-[12px] font-semibold text-[color:var(--c-text-muted)] transition-colors hover:text-[color:var(--c-text)]"
        >
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden>
                <path d="m10 4-4 4 4 4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Plans
        </Link>
    )
}

function Notice({ tone, children }: { tone: "error" | "muted"; children: React.ReactNode }) {
    return (
        <div
            className={cn(
                "rounded-[12px] px-3.5 py-2.5 text-[12.5px]",
                tone === "error"
                    ? "border border-[color:var(--c-error-bg)] bg-[color:var(--c-error-bg)] text-[color:var(--c-error)]"
                    : "border border-[color:var(--c-border)] bg-[color:var(--c-surface-2)] text-[color:var(--c-text-muted)]",
            )}
        >
            {children}
        </div>
    )
}
