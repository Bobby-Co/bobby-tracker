// SlotPolicy — how many teams an email may run for free, which billing identity
// a new team attaches to, and what happens when a paid plan ends.
//
// PURE. This is the rulebook for the whole quota, and it is the part that will be
// argued about, so it is a function of facts rather than a set of conditions
// scattered across three routes.
//
// ─── The quota ───────────────────────────────────────────────────────────────
//
// Each email owns two RESERVED slots, forever:
//
//   personal   the team they get with the account
//   free       one more team, on Kit
//
// plus one subject per PAID team beyond those. Subjects are never deleted, so the
// quota cannot be reset by deleting anything — the whole point of the model.
//
// ─── Occupied vs. existing ───────────────────────────────────────────────────
//
// A slot's subject can exist without occupying the slot, and the distinction is
// what makes the rules work:
//
//   bound + active     occupied — this slot is in use
//   bound + suspended   FREE — the owner paused the team to make room (that is
//                       what the suspend button is for), and the data is intact
//   unbound             FREE — the team was deleted; the subject and its whole
//                       ledger are still here, waiting for the next team
//
// So creating a team asks "is a slot un-occupied?", while binding asks "does this
// slot already have a subject?" — and when it does, the new team inherits that
// subject's balance automatically. Nothing is copied and nothing expires.

export type SlotKind = "personal" | "free" | "paid"
export type SubjectStatus = "active" | "suspended"

/** One billing identity belonging to an email. */
export interface SubjectFacts {
    id: string
    slot: SlotKind
    status: SubjectStatus
    /** The team currently spending against it, or null when the team was deleted
     *  (the subject and its ledger remain). */
    boundTeamId: string | null
}

/** Where a newly created team should attach. */
export type Allocation =
    | {
          allowed: true
          slot: "personal" | "free"
          /** Reuse this subject — the new team inherits its balance. Null when the
           *  slot has never been used and a subject must be created. */
          subjectId: string | null
      }
    | { allowed: false; reason: "needs_paid_plan" }

/** What to do with a paid team whose subscription has ended. */
export type PlanEndAction =
    | {
          action: "downgrade_to_free"
          /** The free-slot subject to rebind onto, or null to create one. The
           *  team's paid-era spend stays on its old subject — history is never
           *  rewritten, it just stops being the one that is billed. */
          subjectId: string | null
      }
    | { action: "suspend" }

export class SlotPolicy {
    /** Where should a team created right now attach?
     *
     *  Personal first, then free. Beyond that the answer is "choose a plan" — not
     *  an error, a different route: paid teams are unlimited, they are just not
     *  free. */
    allocate(subjects: SubjectFacts[]): Allocation {
        for (const slot of ["personal", "free"] as const) {
            const existing = subjects.find((s) => s.slot === slot)
            if (!existing) return { allowed: true, slot, subjectId: null }
            if (!this.occupies(existing)) return { allowed: true, slot, subjectId: existing.id }
        }
        return { allowed: false, reason: "needs_paid_plan" }
    }

    /** A paid subscription has ended. Fall back to the free slot if it is
     *  available; otherwise suspend.
     *
     *  Suspension rather than deletion, always: the team's projects and issues are
     *  not the thing that expired. The way out is to subscribe again, or to free
     *  the slot by pausing whichever team is holding it. */
    onPlanEnd(subjects: SubjectFacts[], endingSubjectId: string): PlanEndAction {
        const others = subjects.filter((s) => s.id !== endingSubjectId)
        const free = others.find((s) => s.slot === "free")
        if (!free) return { action: "downgrade_to_free", subjectId: null }
        if (!this.occupies(free)) return { action: "downgrade_to_free", subjectId: free.id }
        return { action: "suspend" }
    }

    /** May this subject be resumed?
     *
     *  A paid one always may — the plan pays for the slot. A reserved one may only
     *  if its slot is not being held by something else in the meantime, which is
     *  the case where resuming would silently give the owner two free teams. */
    canResume(subjects: SubjectFacts[], subjectId: string): boolean {
        const subject = subjects.find((s) => s.id === subjectId)
        if (!subject) return false
        if (subject.slot === "paid") return true
        return !subjects.some((s) => s.id !== subjectId && s.slot === subject.slot && this.occupies(s))
    }

    /** How many free teams this email is currently running — what the UI shows
     *  next to "you've used 2 of your 2 free teams". */
    freeTeamsInUse(subjects: SubjectFacts[]): number {
        return subjects.filter((s) => s.slot !== "paid" && this.occupies(s)).length
    }

    /** A slot is only held by a team that is both attached AND running. A paused
     *  or deleted team keeps its data and its balance, but not its claim on the
     *  slot — that is exactly what makes the suspend button useful. */
    private occupies(subject: SubjectFacts): boolean {
        return subject.status === "active" && subject.boundTeamId !== null
    }
}
