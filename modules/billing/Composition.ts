// Billing module — composition root for the server-side seams that have no
// request context to hang off: webhooks, public (session-token) endpoints and
// analyser callbacks all need the spend gate, and none of them has a
// RequestContext to reach it through.
//
// Service-role, control plane: billing identity belongs to an email, never to a
// region.

import { Supabase } from "@/lib/server/supabase"
import { SpendGate } from "./application/SpendGate"
import { createSupabaseUsageSubjectStore } from "./infrastructure/SupabaseUsageSubjectStore"
import { createSupabaseSubscriptionsRepository } from "./infrastructure/SupabaseSubscriptionsRepository"

/** The spend gate for guardless server paths. Routes that DO have a request
 *  context should use `ctx.spendGate` (or ApiContext.requireSpend) instead, so
 *  they share the request's clients. */
export function getSpendGate(): SpendGate {
    const db = Supabase.service()
    return new SpendGate(createSupabaseUsageSubjectStore(db), createSupabaseSubscriptionsRepository(db))
}
