// Billing module — composition root for the server-side seams that have no
// request context to hang off: webhooks, public (session-token) endpoints and
// analyser callbacks all need the spend gate, and none of them has a
// RequestContext to reach it through.
//
// Service-role, control plane: billing identity belongs to an email, never to a
// region — and the gate's reads must not be RLS-narrowed, or a deleted team's
// spend disappears and the allowance resets. See SpendGate's header.

import { Supabase } from "@/lib/server/supabase"
import { PeriodUsageReader } from "./application/PeriodUsageReader"
import { RunAllowance } from "./application/RunAllowance"
import { SpendGate } from "./application/SpendGate"
import { createSupabaseUsageRepository } from "./infrastructure/SupabaseUsageRepository"
import { createSupabaseUsageSubjectStore } from "./infrastructure/SupabaseUsageSubjectStore"
import { createSupabaseSubscriptionsRepository } from "./infrastructure/SupabaseSubscriptionsRepository"
import { createSupabaseInvoicesRepository } from "./infrastructure/SupabaseInvoicesRepository"
import { createStripePaymentGateway } from "./infrastructure/StripePaymentGateway"
import { SubscriptionSync } from "./application/SubscriptionSync"
import { BillingReconciler } from "./application/BillingReconciler"

/** The spend gate — suspension AND the monthly allowance.
 *
 *  This is the ONLY way one is built. `RequestContext.spendGate` delegates here
 *  rather than composing its own from the request's RLS clients: the gate has to
 *  see spend the caller cannot (deleted teams bound to the same billing subject),
 *  so an RLS-scoped copy would answer a different, more permissive question on
 *  the session paths than on the webhook ones. */
export function getSpendGate(): SpendGate {
    const db = Supabase.service()
    const subjects = createSupabaseUsageSubjectStore(db)
    return new SpendGate(
        subjects,
        createSupabaseSubscriptionsRepository(db),
        new PeriodUsageReader(subjects, createSupabaseUsageRepository(db)),
    )
}

/** This period's spend for a team, resolved across its whole billing subject.
 *
 *  Service-role for the same reason as the gate: the balance a user is SHOWN and
 *  the balance that stops them must be the same number, and only one of the two
 *  clients can see all of it. */
export function getPeriodUsageReader(): PeriodUsageReader {
    const db = Supabase.service()
    return new PeriodUsageReader(createSupabaseUsageSubjectStore(db), createSupabaseUsageRepository(db))
}

/** How many concurrent billable runs a team may have in flight (its tier's cap).
 *
 *  Service-role, control plane: the subscription is the caller's own team's, but
 *  the dispatch paths that ask are largely webhook-driven and have no session to
 *  read it with. */
export function getRunAllowance(): RunAllowance {
    return new RunAllowance(createSupabaseSubscriptionsRepository(Supabase.service()))
}

/** The payment provider. Stateless — the SDK client it wraps is cached per
 *  isolate — so this is cheap to construct per request. */
export function getPaymentGateway() {
    return createStripePaymentGateway()
}

/** Applies verified payment events to our own billing state.
 *
 *  Service-role, control plane, and necessarily so: a webhook arrives with no
 *  session, from Stripe rather than from a member of the team whose entitlement
 *  it changes. */
export function getSubscriptionSync(): SubscriptionSync {
    const db = Supabase.service()
    return new SubscriptionSync(
        createSupabaseSubscriptionsRepository(db),
        createSupabaseInvoicesRepository(db),
    )
}

/** Pull the truth from the payment provider and apply it.
 *
 *  The safety net under the webhook: whatever a lost delivery failed to write,
 *  this can go and fetch. Service-role like the sync it delegates to — it makes
 *  the same entitlement writes, for the same reason. */
export function getBillingReconciler(): BillingReconciler {
    const db = Supabase.service()
    const subscriptions = createSupabaseSubscriptionsRepository(db)
    const invoices = createSupabaseInvoicesRepository(db)
    return new BillingReconciler(
        subscriptions,
        invoices,
        createStripePaymentGateway(),
        new SubscriptionSync(subscriptions, invoices),
    )
}
