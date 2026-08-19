// Billing infrastructure — the Supabase adapter for UsageSubjectStore. The only
// place that touches tracker.usage_subjects and tracker.usage_subject_teams.
//
// Service-role/control-plane: billing identity is a property of an email, not of
// a team, so it never moves with a region.

import type { SupabaseClient } from "@supabase/supabase-js"
import { RepositoryError } from "@/lib/shared/kernel"
import type { SlotKind, SubjectFacts, SubjectStatus } from "../domain/SlotPolicy"
import type { UsageSubjectStore } from "../ports/UsageSubjectStore"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = SupabaseClient<any, any, any>

const SUBJECTS = "usage_subjects"
const BINDINGS = "usage_subject_teams"

interface BindingRow {
    team_id: string
    unbound_at: string | null
}
interface SubjectRow {
    id: string
    slot: SlotKind
    status: SubjectStatus
    usage_subject_teams?: BindingRow[] | null
}

/** A subject is "bound" to the one team whose binding has no unbound_at. There
 *  can only be one at a time; older rows are history. */
function toFacts(row: SubjectRow): SubjectFacts {
    const live = (row.usage_subject_teams ?? []).find((b) => b.unbound_at === null)
    return { id: row.id, slot: row.slot, status: row.status, boundTeamId: live?.team_id ?? null }
}

export class SupabaseUsageSubjectStore implements UsageSubjectStore {
    constructor(private readonly db: AnyDb) {}

    async listForOwner(ownerHash: string): Promise<SubjectFacts[]> {
        // Embedded read: PostgREST can join usage_subject_teams because the FK
        // exists in that direction. One round trip for the whole picture the
        // policy needs.
        const { data, error } = await this.db
            .from(SUBJECTS)
            .select("id, slot, status, usage_subject_teams(team_id, unbound_at)")
            .eq("owner_hash", ownerHash)
        if (error) throw new RepositoryError(error.message, { cause: error })
        return ((data as SubjectRow[] | null) ?? []).map(toFacts)
    }

    async findForTeam(teamId: string): Promise<SubjectFacts | null> {
        const { data, error } = await this.db
            .from(BINDINGS)
            .select("subject_id, usage_subjects(id, slot, status, usage_subject_teams(team_id, unbound_at))")
            .eq("team_id", teamId)
            .maybeSingle<{ subject_id: string; usage_subjects: SubjectRow | null }>()
        if (error) throw new RepositoryError(error.message, { cause: error })
        const subject = data?.usage_subjects
        return subject ? toFacts(subject) : null
    }

    async create(ownerHash: string, slot: SlotKind): Promise<string> {
        const { data, error } = await this.db
            .from(SUBJECTS)
            .insert({ owner_hash: ownerHash, slot })
            .select("id")
            .single<{ id: string }>()
        if (error) throw new RepositoryError(error.message, { cause: error })
        return data.id
    }

    async bind(subjectId: string, teamId: string): Promise<void> {
        // Upsert on team_id: a team binds to exactly one subject for its whole
        // life, and rebinding (the paid → free downgrade) rewrites that pointer
        // rather than adding a second one.
        const { error } = await this.db
            .from(BINDINGS)
            .upsert(
                { team_id: teamId, subject_id: subjectId, bound_at: new Date().toISOString(), unbound_at: null },
                { onConflict: "team_id" },
            )
        if (error) throw new RepositoryError(error.message, { cause: error })
    }

    async unbind(teamId: string): Promise<void> {
        // The row stays. Deleting it would lose the link between this subject and
        // the ledger rows that still carry the dead team's id — which is the one
        // thing that must survive a team deletion.
        const { error } = await this.db
            .from(BINDINGS)
            .update({ unbound_at: new Date().toISOString() })
            .eq("team_id", teamId)
            .is("unbound_at", null)
        if (error) throw new RepositoryError(error.message, { cause: error })
    }

    async teamIdsFor(subjectId: string): Promise<string[]> {
        const { data, error } = await this.db.from(BINDINGS).select("team_id").eq("subject_id", subjectId)
        if (error) throw new RepositoryError(error.message, { cause: error })
        return ((data as { team_id: string }[] | null) ?? []).map((r) => r.team_id)
    }

    async setStatus(subjectId: string, status: SubjectStatus): Promise<void> {
        const { error } = await this.db.from(SUBJECTS).update({ status }).eq("id", subjectId)
        if (error) throw new RepositoryError(error.message, { cause: error })
    }

    async setSlot(subjectId: string, slot: SlotKind): Promise<void> {
        const { error } = await this.db.from(SUBJECTS).update({ slot }).eq("id", subjectId)
        if (error) throw new RepositoryError(error.message, { cause: error })
    }
}

/** Composition seam: bind a UsageSubjectStore to a Supabase client. */
export function createSupabaseUsageSubjectStore(db: AnyDb): UsageSubjectStore {
    return new SupabaseUsageSubjectStore(db)
}
