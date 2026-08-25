import { ApiContext } from "@/lib/server/http/api"
import { tryOrNull } from "@/lib/shared/kernel"
import { createAccountMailer, getWelcomeLedger } from "@/modules/account"

export const dynamic = "force-dynamic"

// POST /api/account/welcome → { sent }
//
// Sends the welcome email, once. Called by the onboarding wizard the moment it
// finishes — which is the only point in the product that means "this person has
// actually arrived", and which happens in the browser, so it needs a route.
//
// Signed-in only, and the address is the identity provider's, never the caller's
// to choose: this endpoint can therefore only ever mail the person calling it.
// Everything else that keeps it from being a mail cannon lives in the ledger —
// the send is gated on claiming a one-time mark in the user's auth metadata, so
// a reload, a double-submit or a curl loop all get `{ sent: false }`.
export async function POST() {
    const { user, error } = await new ApiContext().requireUser()
    if (error) return error
    if (!user.email) return Response.json({ sent: false })

    // Claim first. Losing the claim is the normal case on any retry.
    const claimed = await getWelcomeLedger().claim(user.id)
    if (!claimed) return Response.json({ sent: false })

    const meta = user.user_metadata ?? {}
    await tryOrNull(() =>
        createAccountMailer().sendWelcome({
            to: user.email as string,
            name: (meta.full_name as string | undefined) ?? (meta.name as string | undefined) ?? null,
            // Written by the onboarding wizard just before it calls this.
            teamName: (meta.team_name as string | undefined) ?? null,
        }),
    )
    return Response.json({ sent: true })
}
