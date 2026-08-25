import Link from "next/link"
import { InvoiceHistory } from "@/components/settings/invoice-history"

// Settings → Usage & Billing → Invoices.
//
// Its own page rather than a table stapled to the bottom of the billing panel.
// The billing panel answers "what am I on and what have I spent"; this answers
// "what have I been charged, and is anything wrong with it" — and the second
// question is the one people arrive with when a payment has failed, so it needs
// to be somewhere you can be SENT, not somewhere you scroll to.
export default function InvoicesPage() {
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
            <h2 className="mt-2 text-[15px] font-bold tracking-[-0.006em]">Invoices</h2>
            <p className="mt-1 text-[13px] text-[color:var(--c-text-muted)]">
                Every month you’re billed grants that month’s credits. An unpaid invoice means the credits for
                that period were never granted — pay it here and they apply as soon as the payment clears.
            </p>
            <div className="mt-5">
                <InvoiceHistory />
            </div>
        </section>
    )
}
