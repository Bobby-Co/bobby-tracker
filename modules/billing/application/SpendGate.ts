// SpendGate — may this team spend right now?
//
// The hard half of suspension AND of the monthly allowance. `usage_subjects.status`
// records that a team is paused; the tier ladder records how much it may spend.
// Without this, both are labels — the team keeps dispatching work to the analyser
// and the analyser keeps billing it, because the analyser has no idea anything
// happened. This is the thing that says no.
//
// ─── Where it sits ───────────────────────────────────────────────────────────
//
// At the tracker's dispatch points, not at the analyser. Every billable call
// starts here — index, analyse, chat, compose, embed, deep-dive — and the tracker
// is the only side that knows about slots and subjects. Enforcing here means one
// codebase, one deploy, and no window where the two disagree. The analyser states
// the same division of labour from its end (internal/server/usage.go): it writes
// the raw cost, "tiers/allowances/enforcement live in the app".
//
// It is deliberately NOT part of authorization. A suspended or empty team's
// members can still read everything they own; they simply cannot spend. Mixing
// the two would mean a pause looked like a permissions failure.
//
// ─── Two refusals, one gate ──────────────────────────────────────────────────
//
// `suspended` is a state somebody chose: an admin paused the team, or a plan
// ended. `exhausted` is arithmetic: the period's spend reached the tier's
// allowance. They are separated because the way out differs — resume vs upgrade
// vs wait for the reset — and a message that guesses wrong sends the user to a
// screen that cannot help them.
//
// Suspension is checked FIRST and short-circuits the balance read. A paused team
// is refused whatever its balance says, so the extra round trip would only ever
// confirm a decision already made.
//
// ─── Fail closed ─────────────────────────────────────────────────────────────
//
// A team whose billing identity can't be read is refused, not waved through. The
// alternative — treating an unreadable subject as "probably fine" — makes every
// database blip a free pass on the one control that stops a team spending. Reads
// THROW rather than returning a default, and the callers turn that into a 503.
// The exception is a team with NO subject at all: those predate 0076 and are
// backfilled lazily, so they are allowed past the SUSPENSION check and must be,
// or the whole app stops for anyone who has not created a team since. They are
// still balance-checked, against their own rollup row.
//
// ─── Why it must read service-role ───────────────────────────────────────────
//
// `usage_subjects` and `usage_subject_teams` have RLS enabled with no policy
// (0076), and `prowl_usage_period` is `is_team_member`-scoped. Under the caller's
// RLS client the subject is invisible and the rollup narrows to teams the caller
// is currently a member of — so a DELETED team's spend, the exact thing 0076
// keeps in order to stop allowance resets, reads as zero. A gate that undercounts
// grants free credits, so this is composed with control-plane service-role
// clients (see Composition.ts). That is sound because the gate filters explicitly
// by team and subject, returns no rows to the caller, and answers only yes/no —
// the same reasoning that lets AccessService run RLS-independent.

import { Balance } from "../domain/Balance"
import { entitledTier } from "../domain/Entitlement"
import { formatPoints } from "../domain/ProwlPoints"
import type { SubscriptionsRepository } from "../ports/SubscriptionsRepository"
import type { UsageSubjectStore } from "../ports/UsageSubjectStore"
import type { PeriodUsageReader } from "./PeriodUsageReader"

/** Why a team may not spend.
 *
 *  `too_many_runs` is not raised by this gate — it is raised by RunAdmission in
 *  the analysis module, which is where in-flight runs are counted. It shares this
 *  vocabulary so that every dispatch path has ONE refusal shape to handle: the
 *  routes turn any of the three into the same 402-with-a-message, and adding a
 *  fourth does not touch them. */
export type SpendRefusalReason = "suspended" | "exhausted" | "too_many_runs"

export interface SpendRefusal {
    reason: SpendRefusalReason
    /** User-facing, and it names the way out — every refusal here is one the
     *  team can act on. */
    message: string
}

export class SpendGate {
    constructor(
        private readonly subjects: UsageSubjectStore,
        private readonly subscriptions: SubscriptionsRepository,
        private readonly periodUsage: PeriodUsageReader,
    ) {}

    /** Null when the team may spend, a refusal when it may not. THROWS when the
     *  billing state cannot be read — callers turn that into a 503 rather than an
     *  allow. */
    async check(teamId: string): Promise<SpendRefusal | null> {
        const [subject, subscription] = await Promise.all([
            this.subjects.findForTeam(teamId),
            this.subscriptions.findByTeam(teamId),
        ])

        // Both are checked because either can be the one a given surface wrote
        // last, and a gate that trusts only one of them is a gate with a race in
        // it. They are kept in step by the suspension route; this is what makes a
        // drift between them fail SAFE rather than silently allow spending.
        const paused = subject?.status === "suspended" || subscription?.status === "suspended"
        if (paused) {
            return {
                reason: "suspended",
                message:
                    "This team is paused, so it can't run any analysis. Resume it in Team → Settings, " +
                    "or put it on a plan.",
            }
        }

        // A team with no subscription row reads as Kit — the same default the
        // billing endpoints show. Defaulting to the floor tier rather than
        // skipping the check keeps a missing row from being a way to spend
        // without limit.
        const tier = subscription?.tier ?? "kit"
        const status = subscription?.status ?? "active"

        // The window being billed, which since 0088 is also the key usage is
        // rolled up under — the two must be the same value or a team is metered
        // over a window it is not being charged for.
        //
        // `current_period_start` and the legacy `period_start` are not the same
        // column and only one is safe to read. The legacy one was written by a
        // column default at team creation and advanced by NOTHING, so reading it
        // meant looking up the rollup row for the month the team was created,
        // forever — every balance froze at month one and this gate quietly
        // stopped firing. `current_period_start` is maintained by the Stripe
        // webhook on every renewal and plan change, which is what makes it
        // trustworthy where the other never was.
        //
        // A team with no subscription period — a free team — is metered over the
        // calendar month, which is the honest meaning of "monthly" for a plan
        // nobody is billed for.
        const periodStart = subscription?.current_period_start ?? Balance.currentPeriodStart()

        // Apex has no ceiling, so the rollup read would be work whose answer
        // cannot change the outcome. The ENTITLED tier decides this: a past-due
        // Apex team is not uncapped, it is on the free plan.
        if (entitledTier(tier, status).isUncapped) return null

        const used = await this.periodUsage.forSubject(subject, teamId, periodStart)
        const balance = new Balance({
            tier,
            status,
            allowanceOverride: subscription?.monthly_points ?? null,
            used: used.points,
            periodStart,
        })
        if (!balance.isExhausted) return null

        return {
            reason: "exhausted",
            message:
                `This team has used all ${formatPoints(balance.allowance ?? 0)} of its credits for ` +
                `this period. They reset on ${resetDay(balance.periodEnd)} — or upgrade the plan in ` +
                `Settings → Billing to keep going now.`,
        }
    }
}

/** "1 Sep" — the period rolls at UTC midnight, so the date is formatted in UTC
 *  rather than the server's zone, which would name the wrong day either side of
 *  the boundary. */
function resetDay(iso: string): string {
    return new Date(iso).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
        timeZone: "UTC",
    })
}
