import { ApiContext, jsonError } from "@/lib/server/http/api"
import { getBillingReconciler } from "@/modules/billing"

export const dynamic = "force-dynamic"

// POST /api/billing/reconcile — "I paid, and nothing happened."
//
// Asks Stripe what this team actually has and writes it down. The safety net
// under the webhook: a delivery that was missed, rejected for a mismatched
// signature, or aimed at an environment that was not listening leaves a customer
// charged and entitled to nothing, and that must not require a support ticket to
// fix.
//
// ─── Open to any MEMBER, not just admins ────────────────────────────────────
//
// Deliberately looser than the routes that SPEND money. This one cannot start a
// purchase, change a plan or move a cent — it can only make our record agree with
// the provider's. The person staring at a plan that did not upgrade is often not
// the admin who bought it, and making them find someone with the right role to
// fix a bug of ours is a poor answer.
//
// Safe to call repeatedly: every write underneath is an upsert or an idempotent
// field assignment, and a team with nothing at the provider returns without
// making a request at all.
export async function POST(request: Request) {
    const { teamId, error } = await new ApiContext(request).requireTeam()
    if (error) return error

    // `force` means a person is asserting a payment happened — the return from
    // checkout, or the "check with Stripe" button. It makes the reconciler ask the
    // provider even when we hold no local link at all, which is the state a team
    // is in when the webhook never arrived and is the whole point of this route.
    let force = false
    try {
        force = ((await request.json()) as { force?: boolean })?.force === true
    } catch {
        // No body is fine — that is the incidental, non-forced call.
    }

    try {
        const result = await getBillingReconciler().reconcileTeam(teamId, { force })
        if (result.changed) {
            // Worth a log line at info: a reconcile that CHANGED something means a
            // webhook was missed, and `via` says which link was lost. A run of
            // these is the signal that the webhook endpoint itself is broken.
            console.info(
                `[reconcile] team ${teamId} corrected via ${result.via}: ` +
                    `${result.tier}/${result.status}, ${result.invoicesMirrored} invoice(s)`,
            )
        }
        return Response.json(result)
    } catch (e) {
        console.error("[reconcile] failed:", (e as Error).message)
        return jsonError("reconcile_failed", "couldn't check with the payment provider — try again", 502)
    }
}
