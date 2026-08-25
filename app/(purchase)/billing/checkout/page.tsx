import { CheckoutPanel } from "@/components/settings/checkout-panel"

// /billing/checkout — confirm and pay.
//
// A real page in our app rather than an immediate bounce to Stripe. The purchase
// is the moment a user most wants to know exactly what they are agreeing to —
// what it costs today, what it costs next month, and what they get — and a
// redirect that happens before they can read any of that is how a plan gets
// bought by accident and refunded by email.
//
// The card itself is still entered on Stripe's hosted page: this page confirms,
// then hands off. No card data ever reaches us.
export default function CheckoutPage() {
    return <CheckoutPanel />
}
