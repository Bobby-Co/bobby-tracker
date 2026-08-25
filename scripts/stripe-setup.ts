#!/usr/bin/env bun
//
// Create (or verify) the Stripe Products and Prices backing the plan ladder.
//
//   bun run scripts/stripe-setup.ts          # test mode
//   bun run scripts/stripe-setup.ts --live   # live mode, and you must mean it
//
// ─── Why a script and not the Stripe dashboard ──────────────────────────────
//
// The amounts have to agree with modules/billing/domain/Tier.ts. The checkout
// page renders the CATALOGUE price while Stripe charges the PRICE object, so if
// the two drift a customer is shown $5 and billed something else — a discrepancy
// nobody notices until it is a refund conversation. This script imports the
// catalogue rather than restating it, so the two cannot disagree: the number on
// the pricing page IS the number sent to Stripe.
//
// ─── Safe to run twice ──────────────────────────────────────────────────────
//
// Every Price is created with a stable `lookup_key`, and an existing one is
// reused rather than duplicated. That matters more here than usual: Stripe Prices
// can be archived but never deleted, so a script that created a fresh one on each
// run would silently litter the account with near-identical prices and leave you
// guessing which id belongs in the env var.
//
// Re-running after a PRICE CHANGE does not mutate the old price — Stripe prices
// are immutable by design, because subscribers are attached to them. The script
// reports the mismatch and leaves it alone; changing what customers pay is a
// deliberate migration, not a side effect of running setup.

import Stripe from "stripe"
import { TIER_IDS, Tier } from "../modules/billing/domain/Tier"

const live = process.argv.includes("--live")
const key = process.env.STRIPE_SECRET_KEY

if (!key) {
    fail(
        "STRIPE_SECRET_KEY is not set.\n" +
            "  Get one from https://dashboard.stripe.com/test/apikeys and run:\n" +
            "    STRIPE_SECRET_KEY=sk_test_... bun run scripts/stripe-setup.ts",
    )
}

// The guard that matters. A live key reached by accident would create real
// products on the real account, and Stripe has no undo for that — only archive.
const isLiveKey = key!.startsWith("sk_live_")
if (isLiveKey && !live) {
    fail("that is a LIVE key. Re-run with --live if you really mean to touch the live account.")
}
if (!isLiveKey && live) {
    fail("--live was passed but the key is a test key. Nothing done.")
}

const stripe = new Stripe(key!)
const mode = isLiveKey ? "LIVE" : "test"

console.log(`\n▸ Prowl plan setup — ${mode} mode\n`)

const envLines: string[] = []
let drift = false

for (const id of TIER_IDS) {
    const tier = Tier.of(id)
    const usd = tier.spec.priceUsd

    // Free and contact-sales tiers have nothing to sell.
    if (usd === null || usd === 0) {
        console.log(`  ${pad(tier.name)} ${usd === null ? "contact sales" : "free"} — no Price needed`)
        continue
    }

    const lookupKey = `prowl_${id}_monthly`
    const amount = Math.round(usd * 100) // minor units; money stays integral

    const existing = (await stripe.prices.list({ lookup_keys: [lookupKey], active: true, limit: 1 })).data[0]

    if (existing) {
        const matches = existing.unit_amount === amount && existing.currency === "usd"
        if (matches) {
            console.log(`  ${pad(tier.name)} $${usd}/mo — exists  ${existing.id}`)
        } else {
            drift = true
            console.log(
                `  ${pad(tier.name)} MISMATCH — Stripe has ` +
                    `${fmt(existing.unit_amount, existing.currency)}, the catalogue says $${usd}.00\n` +
                    `  ${" ".repeat(14)}${existing.id} left untouched; Stripe prices are immutable.\n` +
                    `  ${" ".repeat(14)}Create a new Price and migrate subscribers deliberately.`,
            )
        }
        envLines.push(`STRIPE_PRICE_${id.toUpperCase()}=${existing.id}`)
        continue
    }

    const product = await stripe.products.create({
        name: `Ucelot ${tier.name}`,
        description: tier.spec.tagline,
        // The tier id travels with the product so an operator looking at the
        // Stripe dashboard can tell which plan a product backs without guessing
        // from the name.
        metadata: { prowl_tier: id },
    })

    const price = await stripe.prices.create({
        product: product.id,
        unit_amount: amount,
        currency: "usd",
        recurring: { interval: "month" },
        lookup_key: lookupKey,
        metadata: { prowl_tier: id },
    })

    console.log(`  ${pad(tier.name)} $${usd}/mo — created ${price.id}`)
    envLines.push(`STRIPE_PRICE_${id.toUpperCase()}=${price.id}`)
}

console.log(`\n▸ Add to your ${isLiveKey ? "production env" : ".env.local"}:\n`)
for (const line of envLines) console.log(`    ${line}`)

console.log(
    "\n▸ Still needed by hand:\n" +
        "    • a webhook endpoint at <app-url>/api/webhooks/stripe\n" +
        "      subscribed to customer.subscription.* and invoice.*\n" +
        "    • its signing secret in STRIPE_WEBHOOK_SECRET\n",
)

if (drift) {
    console.error("✗ One or more prices disagree with the catalogue — see above.\n")
    process.exit(1)
}

function pad(name: string): string {
    return (name + " ".repeat(12)).slice(0, 12)
}

function fmt(minor: number | null, currency: string): string {
    if (minor === null) return "no amount"
    return new Intl.NumberFormat("en-US", { style: "currency", currency: currency.toUpperCase() }).format(minor / 100)
}

function fail(message: string): never {
    console.error(`\n✗ ${message}\n`)
    process.exit(1)
}
