import { PlanLadder } from "@/components/settings/plan-ladder"

// /billing/plans — choose a plan. Outside the settings tabs (see the flow
// layout): picking a plan is the first step of a purchase, not a preference.
export default function PlansPage() {
    return (
        <section className="text-center">
            <h2 className="text-[22px] font-bold tracking-[-0.012em]">Choose your plan</h2>
            <p className="mx-auto mt-2 max-w-[52ch] text-[13.5px] text-[color:var(--c-text-muted)]">
                Each tier sets your team’s monthly{" "}
                <span className="font-semibold text-[color:var(--c-text)]">credits</span> allowance. Your
                current plan is highlighted.
            </p>
            <div className="mt-8 text-left">
                <PlanLadder />
            </div>
        </section>
    )
}
