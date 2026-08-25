"use client"

import { useState } from "react"
import { cn } from "@/components/ui/cn"
import { useApi } from "@/lib/client/hooks/use-api"
import { apiMutate } from "@/lib/client/http/api-client"
import { useTeam } from "@/lib/client/auth/team-context"

// The team's invoice history.
//
// Rendered from OUR mirror of Stripe's invoices (tracker.billing_invoices), not
// from Stripe at request time — so the page loads without a third-party round
// trip, and still loads when that third party is having a bad day. The links out
// (hosted invoice, PDF) point at Stripe, which remains the authority on what was
// actually charged and is the thing an accountant will want.

interface Invoice {
    id: string
    number: string | null
    status: "draft" | "open" | "paid" | "uncollectible" | "void"
    amountDue: number
    amountPaid: number
    currency: string
    tier: string | null
    periodStart: string | null
    periodEnd: string | null
    hostedInvoiceUrl: string | null
    invoicePdf: string | null
    issuedAt: string | null
    paidAt: string | null
    created_at: string
}

/** Minor units → "$19.00". Stripe reports cents; dividing at the last moment
 *  keeps the arithmetic in integers, where money belongs. */
function money(minor: number, currency: string): string {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: currency.toUpperCase() }).format(minor / 100)
}

function day(iso: string | null): string {
    if (!iso) return "—"
    return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })
}

const STATUS: Record<Invoice["status"], { label: string; className: string }> = {
    paid: { label: "Paid", className: "bg-[color:var(--c-success-bg)] text-[color:var(--c-success)]" },
    // "Open" is Stripe's word for issued-and-unpaid. Users read that as "fine";
    // what it actually means for them is that we are waiting on their card.
    open: { label: "Due", className: "bg-[color:var(--c-warn-bg)] text-[color:var(--c-warn)]" },
    uncollectible: { label: "Unpaid", className: "bg-[color:var(--c-error-bg)] text-[color:var(--c-error)]" },
    void: { label: "Void", className: "bg-[color:var(--c-surface-2)] text-[color:var(--c-text-dim)]" },
    draft: { label: "Draft", className: "bg-[color:var(--c-surface-2)] text-[color:var(--c-text-dim)]" },
}

export function InvoiceHistory() {
    const { activeTeam } = useTeam()
    const path = activeTeam ? `/api/billing/invoices?t=${activeTeam.id}` : "/api/billing/invoices"
    const { data, error, loading } = useApi<{ invoices: Invoice[] }>(path)

    if (loading && !data) return <div className="h-24 animate-pulse rounded-[14px] bg-[color:var(--c-surface-2)]" />
    if (error) {
        return (
            <p className="text-[12.5px] text-[color:var(--c-text-muted)]">Couldn’t load invoices: {error}</p>
        )
    }
    const invoices = data?.invoices ?? []
    // "Open" is issued-and-unpaid; "uncollectible" is Stripe having given up
    // retrying. Both mean the same thing to the customer — money is owed and the
    // period's credits were never granted — so they are surfaced together.
    const unpaid = invoices.filter((i) => i.status === "open" || i.status === "uncollectible")

    if (invoices.length === 0) {
        return (
            <p className="rounded-[14px] border border-[color:var(--c-border)] bg-[color:var(--c-surface-2)] px-3.5 py-3 text-[12.5px] text-[color:var(--c-text-muted)]">
                No invoices yet. Free plans aren’t billed, so nothing appears here until this team subscribes.
            </p>
        )
    }

    return (
        <div className="flex flex-col gap-4">
            {unpaid.length > 0 && <UnpaidBanner unpaid={unpaid} />}
            <div className="overflow-x-auto rounded-[14px] border border-[color:var(--c-border)]">
            <table className="w-full min-w-[520px] border-collapse text-[12.5px]">
                <thead>
                    <tr className="border-b border-[color:var(--c-border)] bg-[color:var(--c-surface-2)] text-left">
                        <Th>Invoice</Th>
                        <Th>Period</Th>
                        <Th>Status</Th>
                        <Th align="right">Amount</Th>
                        <Th align="right">Receipt</Th>
                    </tr>
                </thead>
                <tbody>
                    {invoices.map((inv) => {
                        const badge = STATUS[inv.status] ?? STATUS.draft
                        const owed = inv.status === "open" || inv.status === "uncollectible"
                        return (
                            <tr key={inv.id} className="border-b border-[color:var(--c-border)] last:border-0">
                                <Td>
                                    <span className="font-semibold">{inv.number ?? "—"}</span>
                                    <span className="ml-1.5 text-[color:var(--c-text-dim)]">{day(inv.issuedAt)}</span>
                                </Td>
                                <Td>
                                    <span className="text-[color:var(--c-text-muted)]">
                                        {day(inv.periodStart)} – {day(inv.periodEnd)}
                                    </span>
                                </Td>
                                <Td>
                                    <span className={cn("rounded-full px-2 py-0.5 text-[10.5px] font-bold", badge.className)}>
                                        {badge.label}
                                    </span>
                                </Td>
                                <Td align="right">
                                    <span className="font-semibold tabular-nums">
                                        {money(inv.status === "paid" ? inv.amountPaid : inv.amountDue, inv.currency)}
                                    </span>
                                </Td>
                                <Td align="right">
                                    {/* An unpaid invoice links to Stripe's hosted
                                        page, which can take a payment; a settled
                                        one links to the PDF, which is what an
                                        accountant asks for. Same column, because
                                        it is the same question: what do I do with
                                        this row. */}
                                    {owed && inv.hostedInvoiceUrl ? (
                                        <a
                                            href={inv.hostedInvoiceUrl}
                                            target="_blank"
                                            rel="noreferrer noopener"
                                            className="font-bold text-[color:var(--c-error)] hover:underline"
                                        >
                                            Pay
                                        </a>
                                    ) : inv.invoicePdf || inv.hostedInvoiceUrl ? (
                                        <a
                                            href={(inv.invoicePdf ?? inv.hostedInvoiceUrl) as string}
                                            target="_blank"
                                            rel="noreferrer noopener"
                                            className="font-semibold text-[color:var(--c-primary)] hover:underline"
                                        >
                                            Receipt
                                        </a>
                                    ) : (
                                        <span className="text-[color:var(--c-text-dim)]">—</span>
                                    )}
                                </Td>
                            </tr>
                        )
                    })}
                </tbody>
                </table>
            </div>
        </div>
    )
}

/** What to do about money that is owed.
 *
 *  Two different fixes, and offering only one is why unpaid invoices linger: a
 *  card that was declined once usually just needs retrying (Pay now), while a card
 *  that has expired needs replacing (Update card) and retrying will fail forever.
 *  The customer knows which of the two they are in; we do not. */
function UnpaidBanner({ unpaid }: { unpaid: Invoice[] }) {
    const [busy, setBusy] = useState(false)
    const [failed, setFailed] = useState<string | null>(null)
    // Oldest first: the one blocking the account is the one that failed first.
    const oldest = [...unpaid].sort((a, b) => a.created_at.localeCompare(b.created_at))[0]
    const total = unpaid.reduce((sum, i) => sum + i.amountDue, 0)

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
        <div className="rounded-[14px] border border-[color:var(--c-error)] bg-[color:var(--c-error-bg)] px-4 py-3.5">
            <p className="text-[13px] font-bold text-[color:var(--c-error)]">
                {unpaid.length === 1
                    ? `One invoice is unpaid — ${money(total, oldest.currency)} due`
                    : `${unpaid.length} invoices are unpaid — ${money(total, oldest.currency)} due`}
            </p>
            <p className="mt-1 text-[12px] leading-relaxed text-[color:var(--c-error)]">
                Your plan’s credits aren’t being granted while this is outstanding. The team keeps working on
                the free allowance in the meantime — nothing has been deleted or switched off.
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
                {oldest.hostedInvoiceUrl && (
                    <a
                        href={oldest.hostedInvoiceUrl}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="rounded-[9px] bg-[color:var(--c-error)] px-3 py-1.5 text-[12px] font-bold text-white transition-opacity hover:opacity-90"
                    >
                        Pay now
                    </a>
                )}
                <button
                    type="button"
                    onClick={toPortal}
                    disabled={busy}
                    className="rounded-[9px] border border-[color:var(--c-error)] px-3 py-1.5 text-[12px] font-bold text-[color:var(--c-error)] transition-colors hover:bg-[color:var(--c-error)]/10 disabled:opacity-50"
                >
                    {busy ? "Opening…" : "Update card"}
                </button>
            </div>
            {failed && <p className="mt-2 text-[11px] text-[color:var(--c-error)]">{failed}</p>}
        </div>
    )
}

function Th({ children, align }: { children: React.ReactNode; align?: "right" }) {
    return (
        <th className={cn("px-3 py-2 text-[11px] font-bold uppercase tracking-wide text-[color:var(--c-text-dim)]", align === "right" && "text-right")}>
            {children}
        </th>
    )
}

function Td({ children, align }: { children: React.ReactNode; align?: "right" }) {
    return <td className={cn("px-3 py-2.5", align === "right" && "text-right")}>{children}</td>
}
