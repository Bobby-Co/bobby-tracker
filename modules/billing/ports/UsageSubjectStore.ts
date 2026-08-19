// The durable billing identity (tracker.usage_subjects + usage_subject_teams,
// migration 0076) — PORT.
//
// Everything here is keyed by the OWNER HASH rather than a user id, because the
// whole point of a subject is to outlive the account: user ids are recreated,
// email addresses are not.

import type { SlotKind, SubjectFacts, SubjectStatus } from "../domain/SlotPolicy"

export interface UsageSubjectStore {
    /** Every subject this email owns, with the team currently bound to each —
     *  the facts SlotPolicy decides on. THROWS. */
    listForOwner(ownerHash: string): Promise<SubjectFacts[]>

    /** The subject a team spends against, or null when it has never been bound
     *  (a team created before 0076, or a failed bind). */
    findForTeam(teamId: string): Promise<SubjectFacts | null>

    /** Create a subject for a slot and return its id. The database's partial
     *  unique index is what actually enforces one personal + one free per email;
     *  a race here surfaces as a constraint violation rather than a second slot. */
    create(ownerHash: string, slot: SlotKind): Promise<string>

    /** Attach a team to a subject. From this moment the team's spend counts
     *  against that subject's balance. */
    bind(subjectId: string, teamId: string): Promise<void>

    /** Detach a team (it was deleted, or moved to another subject). The binding
     *  row REMAINS with `unbound_at` set — it is how the subject's historical
     *  spend is still found. */
    unbind(teamId: string): Promise<void>

    /** Every team id that has ever spent against this subject, including
     *  unbound ones. The balance reads across all of them. */
    teamIdsFor(subjectId: string): Promise<string[]>

    /** Pause or resume a subject. Suspended means: data kept, nothing spent, slot
     *  released. */
    setStatus(subjectId: string, status: SubjectStatus): Promise<void>

    /** Move a subject into another slot — the paid → free step when a plan ends
     *  and the free slot is available. */
    setSlot(subjectId: string, slot: SlotKind): Promise<void>
}
