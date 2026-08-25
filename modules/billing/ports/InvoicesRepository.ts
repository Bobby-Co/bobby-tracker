// The team's invoice history (tracker.billing_invoices) — PORT.
//
// A MIRROR, not a ledger. Stripe remains the record of what was charged; this
// exists so the billing page, the past-due banner and the history list are ours
// to render and query rather than an iframe. Every write comes from the webhook.

import type { InvoiceFacts } from "./PaymentGateway"

export interface InvoiceRow extends InvoiceFacts {
    id: string
    team_id: string
    created_at: string
}

export interface InvoicesRepository {
    /** Mirror one invoice, keyed by its Stripe id. Idempotent by construction:
     *  Stripe delivers the same event more than once as a matter of course, and
     *  invoices move through several statuses, so this is an upsert rather than
     *  an insert. THROWS. */
    upsert(teamId: string, invoice: InvoiceFacts): Promise<void>

    /** A team's invoices, newest first. THROWS. */
    listForTeam(teamId: string, limit: number): Promise<InvoiceRow[]>

    /** Is there a PAID invoice covering this period?
     *
     *  Not used for entitlement — the subscription's status is what decides that,
     *  because Stripe sets it from the same payment outcome and does so for the
     *  whole dunning lifecycle. This exists for the UI ("paid through March") and
     *  for answering support questions without opening the Stripe dashboard. */
    hasPaidInvoiceFor(teamId: string, periodStart: string): Promise<boolean>
}
