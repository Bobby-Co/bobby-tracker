// What deleting an account actually does to the teams behind it.
//
// PURE. No I/O, no SDK — the whole point is that the most destructive decision in
// the product is a function you can read in one sitting and test exhaustively.
// The route gathers the facts and carries the plan out; nothing here can delete
// anything.
//
// ─── The rule, and why it is this one ────────────────────────────────────────
//
// Three dispositions, decided per team:
//
//   BLOCKED  the caller is the team's only owner and other people are in it.
//            Deleting would take a working team — its projects, issues, billing
//            — away from members who never asked for it, and there is no undo.
//            So the account deletion refuses and names the teams: transfer
//            ownership, or delete the team deliberately, then come back.
//
//   DELETE   the team goes with the account. Two cases: their PERSONAL team,
//            which exists only because they do, and any team where they are the
//            only owner AND the only member — nobody else can see it, and
//            leaving it behind would strand an unreachable team owned by a
//            deleted user.
//
//   LEAVE    the team survives without them: somebody else owns it, or co-owns
//            it. Their membership row goes; nothing else does.
//
// The asymmetry between BLOCKED and DELETE is deliberate. "Sole owner, alone" is
// unambiguous — no one else is affected. "Sole owner, with members" is a decision
// about other people's work, and the person deleting their account is exactly the
// person who is about to stop being available to ask.

// The role type comes from the access module's DOMAIN, not from the DB row type
// in @/lib/shared/types — this layer stays free of persistence shapes (the same
// rule Role.ts states, enforced by the no-restricted-imports lint).
import type { TeamRoleValue } from "@/modules/access"

/** One team the account belongs to, reduced to what the decision needs. */
export interface TeamFacts {
    id: string
    name: string
    isPersonal: boolean
    /** The departing user's role in this team. */
    myRole: TeamRoleValue
    /** Owners INCLUDING the departing user. */
    ownerCount: number
    /** Members INCLUDING the departing user. */
    memberCount: number
}

export type Disposition = "delete" | "leave" | "blocked"

export interface DeletionPlan {
    /** Teams that must be dealt with first. Non-empty means the account deletion
     *  does not run at all — this is a refusal, not a partial delete. */
    blocked: TeamFacts[]
    /** Teams deleted along with the account (content and all). */
    toDelete: TeamFacts[]
    /** Teams the user merely leaves. */
    toLeave: TeamFacts[]
}

export class AccountDeletionPlanner {
    /** Sort every team into its disposition. Total: each team lands in exactly
     *  one bucket, so `blocked + toDelete + toLeave` is the input, re-partitioned. */
    plan(teams: TeamFacts[]): DeletionPlan {
        const blocked: TeamFacts[] = []
        const toDelete: TeamFacts[] = []
        const toLeave: TeamFacts[] = []

        for (const team of teams) {
            switch (this.dispositionOf(team)) {
                case "blocked":
                    blocked.push(team)
                    break
                case "delete":
                    toDelete.push(team)
                    break
                case "leave":
                    toLeave.push(team)
                    break
            }
        }
        return { blocked, toDelete, toLeave }
    }

    /** Whether the plan can be carried out as-is. */
    canProceed(plan: DeletionPlan): boolean {
        return plan.blocked.length === 0
    }

    private dispositionOf(team: TeamFacts): Disposition {
        // A personal team is bootstrapped from the user and cannot be shared —
        // the UI offers no way to invite anyone into one — so it always goes with
        // them. If one ever DID hold other members, this would remove their
        // access silently; that is a schema invariant we are relying on, stated
        // here so it is a known assumption rather than an oversight.
        if (team.isPersonal) return "delete"

        // Somebody else owns or co-owns it: the team is fine without them.
        if (team.myRole !== "owner" || team.ownerCount > 1) return "leave"

        // Sole owner. Alone → the team is theirs alone and goes too. With others
        // → refuse, and let them choose what happens to it.
        return team.memberCount > 1 ? "blocked" : "delete"
    }
}
