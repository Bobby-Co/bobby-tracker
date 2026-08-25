import { BillingPanel } from "@/components/settings/billing-panel"
import Link from "next/link"

// Settings → Usage & Billing. The team's Prowl tier, this period's credit
// balance, a usage breakdown and the plan ladder. Acts on the ACTIVE team (the
// top-bar selector); the panel fetches /api/billing, which resolves that team.
export default function BillingPage() {
    return (
        <section>
            <h2 className="text-[15px] font-bold tracking-[-0.006em]">Usage &amp; Billing</h2>
            <p className="mt-1 text-[13px] text-[color:var(--c-text-muted)]">
                Every AI call spends <span className="font-semibold text-[color:var(--c-text)]">credits</span> from
                this team’s monthly allowance. Track spend and manage your plan here.
            </p>
            <div className="mt-5">
                <BillingPanel />
            </div>

            {/* A link, not the table. This page answers "what am I on and what
                have I spent"; invoices are a different question, and people
                arrive at them from a failed-payment email rather than by
                scrolling to the bottom of a usage panel. */}
            <Link
                href="/settings/billing/invoices"
                className="mt-6 flex items-center justify-between gap-4 rounded-[14px] border border-[color:var(--c-border)] bg-[color:var(--c-surface)] px-4 py-3.5 transition-colors hover:border-[color:var(--c-border-strong)]"
            >
                <span>
                    <span className="block text-[13.5px] font-bold tracking-[-0.006em]">Invoices</span>
                    <span className="mt-0.5 block text-[12.5px] text-[color:var(--c-text-muted)]">
                        Receipts, and anything still owed.
                    </span>
                </span>
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden className="shrink-0 text-[color:var(--c-text-dim)]">
                    <path d="m6 4 4 4-4 4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
            </Link>
        </section>
    )
}
