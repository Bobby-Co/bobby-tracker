import Link from "next/link"
import { PlanLadder } from "@/components/settings/plan-ladder"

// Settings → Usage & Billing → Change plan. The tier ladder on its own page so the
// billing page stays about the current plan + spend. Acts on the ACTIVE team.
export default function PlansPage() {
    return (
        <section>
            <Link
                href="/settings/billing"
                className="inline-flex items-center gap-1 text-[12px] font-semibold text-[color:var(--c-text-muted)] transition-colors hover:text-[color:var(--c-text)]"
            >
                <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden>
                    <path d="m10 4-4 4 4 4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                Usage &amp; Billing
            </Link>
            <h2 className="mt-2 text-[15px] font-bold tracking-[-0.006em]">Choose your plan</h2>
            <p className="mt-1 text-[13px] text-[color:var(--c-text-muted)]">
                Each tier sets your team’s monthly <span className="font-semibold text-[color:var(--c-text)]">credits</span> allowance.
                Your current plan is highlighted.
            </p>
            <div className="mt-5">
                <PlanLadder />
            </div>
        </section>
    )
}
