import { redirect } from "next/navigation"

// Moved to /billing/checkout. This one matters more than the plans redirect: it
// is the `cancel_url` on every Stripe Checkout session created before the move,
// so a customer who abandons an in-flight session still lands somewhere real.
export default async function MovedCheckoutPage({
    searchParams,
}: {
    searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
    const params = await searchParams
    const tier = typeof params.tier === "string" ? params.tier : ""
    const canceled = params.canceled === "1" ? "&canceled=1" : ""
    redirect(`/billing/checkout?tier=${encodeURIComponent(tier)}${canceled}`)
}
