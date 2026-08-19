// PeriodUsageReader — "what has this team spent this period?", answered once.
//
// Since 0076 the answer is not a property of the team. It belongs to the team's
// billing SUBJECT and is summed across every team that subject has ever been
// bound to, which is what makes a balance survive the team being deleted and
// follow the one that replaces it.
//
// This exists as a service rather than as two lines in each route because there
// are two readers — the sidebar pill (GET /api/billing/balance) and the billing
// page (GET /api/billing) — and a balance that differs between them is a bug
// users notice immediately and nobody can explain.

import type { UsageRepository, PeriodUsage } from "../ports/UsageRepository"
import type { UsageSubjectStore } from "../ports/UsageSubjectStore"

export class PeriodUsageReader {
    constructor(
        private readonly subjects: UsageSubjectStore,
        private readonly usage: UsageRepository,
    ) {}

    async forTeam(teamId: string, periodStart: string): Promise<PeriodUsage> {
        const subject = await this.subjects.findForTeam(teamId)
        // No subject: a team created before 0076 that the lazy backfill on the
        // team-create path hasn't reached yet. Reading its own rollup row is
        // exactly what it did before, so the fallback is the old behaviour rather
        // than a guess.
        if (!subject) return this.usage.currentPeriodUsage(teamId, periodStart)

        const teamIds = await this.subjects.teamIdsFor(subject.id)
        return this.usage.subjectPeriodUsage(teamIds, periodStart)
    }
}
