// Supabase adapter for InvoicesRepository. The only place that touches
// tracker.billing_invoices.

import type { SupabaseClient } from "@supabase/supabase-js"
import { RepositoryError } from "@/lib/shared/kernel"
import type { InvoiceFacts } from "../ports/PaymentGateway"
import type { InvoiceRow, InvoicesRepository } from "../ports/InvoicesRepository"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = SupabaseClient<any, any, any>

const COLS =
    "id, team_id, stripe_invoice_id, number, status, amount_due, amount_paid, currency, " +
    "tier, period_start, period_end, hosted_invoice_url, invoice_pdf, issued_at, paid_at, created_at"

/** The wire shape: snake_case columns, camelCase domain. */
function toRow(teamId: string, i: InvoiceFacts) {
    return {
        team_id: teamId,
        stripe_invoice_id: i.stripeInvoiceId,
        number: i.number,
        status: i.status,
        amount_due: i.amountDue,
        amount_paid: i.amountPaid,
        currency: i.currency,
        tier: i.tier,
        period_start: i.periodStart,
        period_end: i.periodEnd,
        hosted_invoice_url: i.hostedInvoiceUrl,
        invoice_pdf: i.invoicePdf,
        issued_at: i.issuedAt,
        paid_at: i.paidAt,
    }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fromRow(r: any): InvoiceRow {
    return {
        id: r.id,
        team_id: r.team_id,
        created_at: r.created_at,
        stripeInvoiceId: r.stripe_invoice_id,
        number: r.number,
        status: r.status,
        amountDue: Number(r.amount_due ?? 0),
        amountPaid: Number(r.amount_paid ?? 0),
        currency: r.currency,
        tier: r.tier,
        periodStart: r.period_start,
        periodEnd: r.period_end,
        hostedInvoiceUrl: r.hosted_invoice_url,
        invoicePdf: r.invoice_pdf,
        issuedAt: r.issued_at,
        paidAt: r.paid_at,
    }
}

export class SupabaseInvoicesRepository implements InvoicesRepository {
    constructor(private readonly db: AnyDb) {}

    async upsert(teamId: string, invoice: InvoiceFacts): Promise<void> {
        const { error } = await this.db
            .from("billing_invoices")
            .upsert(toRow(teamId, invoice), { onConflict: "stripe_invoice_id" })
        if (error) throw new RepositoryError(error.message, { cause: error })
    }

    async listForTeam(teamId: string, limit: number): Promise<InvoiceRow[]> {
        const { data, error } = await this.db
            .from("billing_invoices")
            .select(COLS)
            .eq("team_id", teamId)
            // Drafts are Stripe's working state, not something a customer has
            // been asked to pay. Showing them would put rows in the history that
            // can still change amount or vanish entirely.
            .neq("status", "draft")
            .order("created_at", { ascending: false })
            .limit(limit)
        if (error) throw new RepositoryError(error.message, { cause: error })
        return (data ?? []).map(fromRow)
    }

    async hasPaidInvoiceFor(teamId: string, periodStart: string): Promise<boolean> {
        const { data, error } = await this.db
            .from("billing_invoices")
            .select("id")
            .eq("team_id", teamId)
            .eq("status", "paid")
            // The invoice for a period may be raised slightly before it starts, so
            // this matches invoices whose period COVERS the anchor rather than
            // ones that start exactly on it.
            .lte("period_start", periodStart)
            .gt("period_end", periodStart)
            .limit(1)
        if (error) throw new RepositoryError(error.message, { cause: error })
        return (data ?? []).length > 0
    }
}

export function createSupabaseInvoicesRepository(db: AnyDb): InvoicesRepository {
    return new SupabaseInvoicesRepository(db)
}
