"use client"

import { useState } from "react"
import Link from "next/link"
import { cn } from "@/components/ui/cn"
import { useApi } from "@/lib/client/hooks/use-api"
import { apiMutate } from "@/lib/client/http/api-client"
import { useTeam } from "@/lib/client/auth/team-context"

// The plan ladder — its own page (Settings → Usage & Billing → Change plan). Kept
// separate from the billing panel so that page stays about the CURRENT plan +
// spend; choosing a plan is a distinct decision. Copy/prices come from the server
// (modules/billing Tier) via /api/billing.

interface TierSpec {
    id: string
    name: string
    tagline: string
    monthlyPoints: number | null
    priceUsd: number | null
    seats: number | null
    features: string[]
}
interface LadderData {
    role: string
    /** `plan` is what the team BOUGHT — the right thing to mark "Current". A
     *  past-due team is still on its plan; `balance.tier` would say Kit, which
     *  would both mis-highlight the ladder and quietly suggest they downgraded. */
    balance: { tier: string; plan: string; pastDue: boolean }
    hasBillingAccount: boolean
    tiers: TierSpec[]
}

// One accent hue per tier, as a raw colour rather than a Tailwind shade.
//
// The washes and rings are derived from it with color-mix, so every surface here
// is a percentage of the SAME hue over whatever the page background happens to
// be. The previous fixed shades (bg-sky-50, text-amber-600) were light-mode
// values: in dark mode a 50-weight wash is a near-white slab, which is how a
// pricing table ends up glowing.
const TIER_HUE: Record<string, string> = {
    kit: "#8A8F9C",
    scout: "#3B82F6",
    // Gold rather than orange, deliberately: --c-primary is #e9730f, and an amber
    // this close to it made the recommended ring and the current-plan border read
    // as the same signal.
    prowler: "#D9A21B",
    pride: "#10A05F",
    apex: "#7C6BF0",
}

/** The tier this ladder recommends. Highlighting one is a real decision — it is
 *  the plan most teams should be on, and saying so is more use than presenting
 *  five equal options and leaving the reader to work it out. */
const RECOMMENDED = "prowler"

function hue(tierId: string): string {
    return TIER_HUE[tierId] ?? TIER_HUE.kit
}

/** A percentage of a tier's hue, over whatever is behind it. */
function wash(tierId: string, pct: number): string {
    return `color-mix(in srgb, ${hue(tierId)} ${pct}%, transparent)`
}


function fmtPoints(n: number): string {
    const v = Math.max(0, Math.round(n))
    if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`
    if (v >= 10_000) return `${(v / 1_000).toFixed(1).replace(/\.0$/, "")}k`
    return v.toLocaleString("en-US")
}

export function PlanLadder() {
    const { activeTeam } = useTeam()
    const path = activeTeam ? `/api/billing?t=${activeTeam.id}` : "/api/billing"
    const { data, error, loading } = useApi<LadderData>(path)

    if (loading && !data) return <LadderSkeleton />
    if (error) {
        return (
            <div className="rounded-[14px] border border-[color:var(--c-error-bg)] bg-[color:var(--c-error-bg)] px-4 py-3 text-[13px] text-[color:var(--c-error)]">
                Couldn’t load plans: {error}
            </div>
        )
    }
    if (!data) return null

    const isAdmin = data.role === "owner" || data.role === "admin"
    const current = data.balance.plan
    const currentIdx = data.tiers.findIndex((t) => t.id === current)

    return (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 xl:pt-5">
            {data.tiers.map((t, i) => (
                <TierCard
                    key={t.id}
                    tier={t}
                    isCurrent={t.id === current}
                    isBelow={i < currentIdx}
                    canManage={isAdmin}
                    hasBillingAccount={data.hasBillingAccount}
                />
            ))}
        </div>
    )
}

function TierCard({
    tier,
    isCurrent,
    isBelow,
    canManage,
    hasBillingAccount,
}: {
    tier: TierSpec
    isCurrent: boolean
    isBelow: boolean
    canManage: boolean
    hasBillingAccount: boolean
}) {
    const featured = tier.id === RECOMMENDED
    const c = hue(tier.id)

    return (
        <article
            className={cn(
                // gap on the column, not margins on the children: the card has a
                // single vertical rhythm and one place to change it.
                "relative flex flex-col gap-4 rounded-[16px] border p-5 transition-colors",
                // The two markers say different KINDS of thing, so they are drawn
                // differently rather than in different colours — colour alone was
                // never going to hold them apart, and it did not.
                //
                //   recommended → an outlined card that lifts off the page. An
                //                 offer, asking to be looked at.
                //   current     → a recessed card, settled into it. A state; you
                //                 are already here and it should not compete.
                //
                // They compose without collision when the recommended plan IS the
                // current one: a ringed card that sits down rather than up.
                isCurrent
                    ? "border-[color:var(--c-border-strong)] bg-[color:var(--c-surface-2)]"
                    : "border-[color:var(--c-border)] bg-[color:var(--c-surface)]",
                // The lift, and only where it means anything.
                //
                // At xl the ladder is one row of five and Prowler is the middle
                // card, so raising it reads as "this one" — the oldest trick on a
                // pricing page, and it still works because it is the one signal
                // that survives being skimmed. Below xl the cards wrap, the middle
                // is wherever the wrap lands it, and a card floating out of a
                // two-column stack just looks misaligned. There, the ring, badge
                // and coloured CTA carry it.
                //
                // A transform rather than a margin: it must not change the grid's
                // row height, or every other card grows a gap under it.
                featured && "xl:-translate-y-5",
            )}
            style={
                featured
                    ? {
                          // Lifted cards cast further. Without this the card
                          // reads as nudged out of alignment rather than raised.
                          boxShadow: isCurrent
                              ? `0 0 0 2px ${c}`
                              : `0 0 0 2px ${c}, 0 18px 40px -22px rgba(0,0,0,0.55)`,
                          borderColor: "transparent",
                      }
                    : undefined
            }
        >
            {(featured || isCurrent) && (
                <span
                    className={cn(
                        "absolute -top-2.5 left-5 flex items-center gap-1 rounded-full px-2 py-0.5",
                        "text-[9.5px] font-bold uppercase tracking-[0.07em]",
                        isCurrent
                            // Outlined and quiet: a label on the card, not a flag
                            // planted on it.
                            ? "border border-[color:var(--c-border-strong)] bg-[color:var(--c-surface)] text-[color:var(--c-text-muted)]"
                            : "text-white",
                    )}
                    style={isCurrent ? undefined : { background: c }}
                >
                    {isCurrent && <TickGlyph />}
                    {isCurrent ? "Your plan" : "Most popular"}
                </span>
            )}

            {/* Each tier's own mark. They read as a set and as a progression —
                a den, tracks, a paw, a group, a summit — which is the same story
                the ladder tells in prices. */}
            <div
                className="flex h-11 w-11 items-center justify-center rounded-[12px]"
                style={{ background: wash(tier.id, featured ? 18 : 12) }}
            >
                <TierMark tier={tier.id} color={c} />
            </div>

            <div className="flex flex-col gap-1">
                <h5 className="text-[16px] font-extrabold leading-none tracking-[-0.012em]">{tier.name}</h5>
                <p className="min-h-[30px] text-[11.5px] leading-snug text-[color:var(--c-text-muted)]">
                    {tier.tagline}
                </p>
            </div>

            <div className="flex items-baseline gap-1">
                <span className="text-[24px] font-extrabold leading-none tracking-[-0.02em] tabular-nums">
                    {tier.priceUsd === null ? "Custom" : tier.priceUsd === 0 ? "Free" : `$${tier.priceUsd}`}
                </span>
                {tier.priceUsd !== null && tier.priceUsd > 0 && (
                    <span className="text-[11.5px] font-semibold text-[color:var(--c-text-dim)]">/mo</span>
                )}
            </div>

            <p
                className="rounded-[9px] px-2.5 py-2 text-[11.5px] font-bold"
                style={{ background: wash(tier.id, featured ? 18 : 12), color: c }}
            >
                {tier.monthlyPoints === null
                    ? "Unlimited credits"
                    : `${fmtPoints(tier.monthlyPoints)} credits / mo`}
            </p>

            <ul className="flex flex-1 flex-col gap-2">
                {tier.features.map((f) => (
                    <li
                        key={f}
                        className="flex items-start gap-1.5 text-[11.5px] leading-snug text-[color:var(--c-text-muted)]"
                    >
                        <CheckIcon />
                        <span>{f}</span>
                    </li>
                ))}
            </ul>

            <PlanAction
                tier={tier}
                isCurrent={isCurrent}
                isBelow={isBelow}
                canManage={canManage}
                hasBillingAccount={hasBillingAccount}
                featured={featured}
                accent={c}
            />
        </article>
    )
}

/** The per-tier icons.
 *
 *  One drawn family, not five unrelated glyphs: every tier is the same cat head,
 *  and what changes is what is around it. That shared silhouette is what makes
 *  them read as a ladder at a glance — five different animals would just look
 *  like five different products.
 *
 *  Each tier's addition is its NAME, made visible:
 *
 *      Kit      a small head, ears still too big for it
 *      Scout    tracks trailing behind — something that went out and looked
 *      Prowler  whiskers out, on the hunt
 *      Pride    a mane; the one cat that is never counted alone
 *      Apex     a crown, because there is nothing above it
 *
 *  Drawn once at 24×24 and positioned with transforms rather than five
 *  hand-tuned copies of the same path — one shape to correct if it is wrong,
 *  and no chance of the family drifting apart glyph by glyph.
 */

/** The shared silhouette: two ears, a tapered jaw. Every tier wears it. */
const CAT_HEAD =
    "M12 20.4c-4.3 0-7.4-2.8-7.4-6.7V4.3l4.2 3.3a10.8 10.8 0 0 1 6.4 0l4.2-3.3v9.4c0 3.9-3.1 6.7-7.4 6.7Z"

function TierMark({ tier, color }: { tier: string; color: string }) {
    const svg = { width: 26, height: 26, viewBox: "0 0 24 24", "aria-hidden": true } as const
    // Strokes are drawn, not filled, so they stay crisp against the tinted tile.
    const line = { stroke: color, strokeWidth: 1.7, strokeLinecap: "round" } as const

    if (tier === "scout") {
        return (
            <svg {...svg}>
                {/* Tracks first, so the head sits over them. */}
                <circle cx="3.2" cy="20.6" r="1.15" fill={color} opacity="0.35" />
                <circle cx="6.9" cy="21.6" r="1.35" fill={color} opacity="0.55" />
                <g transform="translate(3.4 -1.6) scale(0.83)">
                    <path d={CAT_HEAD} fill={color} />
                </g>
            </svg>
        )
    }

    if (tier === "prowler") {
        return (
            <svg {...svg}>
                <g {...line} opacity="0.6">
                    <path d="M1.4 12.4h2.6M1.9 15.4l2.3-.7" />
                    <path d="M22.6 12.4H20M22.1 15.4l-2.3-.7" />
                </g>
                <path d={CAT_HEAD} fill={color} />
            </svg>
        )
    }

    if (tier === "pride") {
        return (
            <svg {...svg}>
                {/* The mane: a ring the head sits inside. */}
                <circle cx="12" cy="13.4" r="10.1" fill="none" stroke={color} strokeWidth="1.6" opacity="0.45" />
                <g transform="translate(2.05 1.6) scale(0.83)">
                    <path d={CAT_HEAD} fill={color} />
                </g>
            </svg>
        )
    }

    if (tier === "apex") {
        return (
            <svg {...svg}>
                {/* Crown: three points and a band. */}
                <path
                    d="M5.6 5.1V1.4l3.2 2.1L12 .6l3.2 2.9 3.2-2.1v3.7Z"
                    fill={color}
                    opacity="0.75"
                />
                <g transform="translate(2.4 3.1) scale(0.8)">
                    <path d={CAT_HEAD} fill={color} />
                </g>
            </svg>
        )
    }

    // Kit — smaller, and centred low so the ears read as oversized.
    return (
        <svg {...svg}>
            <g transform="translate(3.1 3.4) scale(0.74)">
                <path d={CAT_HEAD} fill={color} />
            </g>
        </svg>
    )
}

/** What the button on a plan card actually does.
 *
 *  Three different things, and the distinction is the whole reason this is a
 *  component rather than an onClick:
 *
 *    * a team with NO Stripe customer is BUYING — it goes to our checkout page,
 *      which confirms the charge and then hands off to Stripe;
 *    * a team that already has one is CHANGING — that goes to Stripe's billing
 *      portal, because switching plans mid-period means proration, and refunds
 *      and cancellation rules that Stripe already implements correctly. Building
 *      a second, subtly different version of that in-app is how billing disputes
 *      start;
 *    * Apex has no price, so there is nothing to buy without talking to someone.
 */
function PlanAction({
    tier,
    isCurrent,
    isBelow,
    canManage,
    hasBillingAccount,
    featured,
    accent,
}: {
    tier: TierSpec
    isCurrent: boolean
    isBelow: boolean
    canManage: boolean
    hasBillingAccount: boolean
    featured: boolean
    accent: string
}) {
    const [busy, setBusy] = useState(false)
    const [failed, setFailed] = useState<string | null>(null)

    // No top margin: the card's own gap spaces this, like every other child.
    const shape = cn(
        "block w-full rounded-[10px] px-3 py-2.5 text-center text-[12.5px] font-bold transition-opacity",
        isCurrent
            ? "cursor-default bg-[color:var(--c-surface-2)] text-[color:var(--c-text-muted)]"
            : isBelow
              ? "border border-[color:var(--c-border-strong)] text-[color:var(--c-text-muted)] hover:bg-[color:var(--c-surface-2)] disabled:opacity-50"
              : featured
                ? "text-white hover:opacity-90 disabled:opacity-50"
                : "bg-[color:var(--c-primary)] text-white hover:bg-[color:var(--c-primary-hover)] disabled:opacity-50",
    )
    // The recommended card's button wears the tier's own hue, so the badge, the
    // ring and the call to action all read as one thing rather than three.
    const tint = featured && !isCurrent && !isBelow ? { background: accent } : undefined

    if (isCurrent) {
        return (
            <button type="button" disabled className={shape}>
                Current plan
            </button>
        )
    }

    if (tier.priceUsd === null) {
        return (
            <a href="mailto:sales@ucelot.dev?subject=Apex%20plan" className={shape} style={tint}>
                Contact sales
            </a>
        )
    }

    if (!canManage) {
        return (
            <button type="button" disabled title="Only a team owner or admin can change the plan" className={shape} style={tint}>
                {isBelow ? "Downgrade" : "Upgrade"}
            </button>
        )
    }

    // DOWNGRADES and cancellation go to Stripe's portal. Upgrades do not: the
    // credit discount is our rule, computed from credits Stripe cannot see, so it
    // has to be priced on our own page. Downgrades deliberately do NOT get that
    // discount — leftover credits from a larger plan would routinely exceed a
    // smaller plan's price and hand out free months.
    if (hasBillingAccount && isBelow) {
        const toPortal = async () => {
            setBusy(true)
            setFailed(null)
            try {
                const { url } = await apiMutate<{ url: string }>("/api/billing/portal", { method: "POST" })
                window.location.assign(url)
            } catch (e) {
                setFailed((e as { message?: string }).message ?? "Couldn’t open billing")
                setBusy(false)
            }
        }
        return (
            <>
                <button type="button" onClick={toPortal} disabled={busy} className={shape} style={tint}>
                    {busy ? "Opening…" : "Downgrade"}
                </button>
                {failed && <p className="mt-1.5 text-[11px] text-[color:var(--c-error)]">{failed}</p>}
            </>
        )
    }

    return (
        <Link href={`/billing/checkout?tier=${tier.id}`} className={shape} style={tint}>
            {hasBillingAccount ? "Upgrade" : isBelow ? "Downgrade" : "Upgrade"}
        </Link>
    )
}

/** The small tick on the current-plan label. Distinct from the feature-list
 *  check: this one is a status, so it takes the surrounding muted colour rather
 *  than the success green a feature bullet uses. */
function TickGlyph() {
    return (
        <svg width="9" height="9" viewBox="0 0 16 16" fill="none" aria-hidden className="shrink-0">
            <path d="M13 4.5 6.5 11 3 7.5" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    )
}

function CheckIcon() {
    return (
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" className="mt-0.5 shrink-0 text-[color:var(--c-success)]" aria-hidden>
            <path d="M13 4.5 6.5 11 3 7.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    )
}

/** The ladder's length, for the placeholder. Local rather than imported from
 *  billing: this file is a client component and the catalogue drags server-side
 *  composition in with it. A count that drifts costs one frame of reflow, which
 *  is the right price for keeping the boundary clean. */
const TIER_IDS_FOR_SKELETON = ["kit", "scout", "prowler", "pride", "apex"]

function LadderSkeleton() {
    return (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
            {/* One per tier, at roughly the loaded card's height — a skeleton that
                is the wrong SHAPE reflows the grid the moment data lands, which is
                the one thing it exists to prevent. */}
            {TIER_IDS_FOR_SKELETON.map((id) => (
                <div key={id} className="skeleton h-[400px] w-full rounded-[16px]" />
            ))}
        </div>
    )
}
