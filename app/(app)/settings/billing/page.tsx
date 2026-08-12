import { BillingPanel } from "@/components/settings/billing-panel"

// Settings → Usage & Billing. The team's Prowl tier, this period's Prowl Point
// balance, a usage breakdown and the plan ladder. Acts on the ACTIVE team (the
// top-bar selector); the panel fetches /api/billing, which resolves that team.
export default function BillingPage() {
    return (
        <section>
            <h2 className="text-[15px] font-bold tracking-[-0.006em]">Usage &amp; Billing</h2>
            <p className="mt-1 text-[13px] text-[color:var(--c-text-muted)]">
                Every AI call spends <span className="font-semibold text-[color:var(--c-text)]">Prowl Points</span> from
                this team’s monthly allowance. Track spend and manage your plan here.
            </p>
            <div className="mt-5">
                <BillingPanel />
            </div>
        </section>
    )
}
