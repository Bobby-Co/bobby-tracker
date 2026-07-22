// Teams infrastructure — the Supabase adapter for TeamInvitesRepository. The only
// place that queries team_invites. Bound to the caller's RLS-scoped client
// (admin-only RLS on the table).

import type { SupabaseClient } from "@supabase/supabase-js"
import { RepositoryError } from "@/lib/shared/kernel"
import type { TeamInvite } from "@/lib/shared/types"
import type { InviteCreateResult, NewInvite, TeamInvitesRepository } from "../ports/TeamInvitesRepository"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = SupabaseClient<any, any, any>

export class SupabaseTeamInvitesRepository implements TeamInvitesRepository {
    constructor(private readonly db: AnyDb) {}

    async listPending(teamId: string): Promise<TeamInvite[]> {
        const { data, error } = await this.db
            .from("team_invites")
            .select("*")
            .eq("team_id", teamId)
            .is("accepted_at", null)
            .order("created_at", { ascending: false })
        if (error) throw new RepositoryError(error.message, { cause: error })
        return (data ?? []) as TeamInvite[]
    }

    async create(input: NewInvite): Promise<InviteCreateResult> {
        const { data, error } = await this.db
            .from("team_invites")
            .insert({
                team_id: input.teamId,
                email: input.email,
                role: input.role,
                token: input.token,
                invited_by: input.invitedBy,
                expires_at: input.expiresAt,
            })
            .select("*")
            .single<TeamInvite>()
        if (error) {
            // 23505 = the partial-unique "one live invite per email per team".
            if (error.code === "23505") return { ok: false, reason: "duplicate" }
            throw new RepositoryError(error.message, { cause: error })
        }
        return { ok: true, invite: data }
    }

    async revoke(teamId: string, token: string): Promise<void> {
        const { error } = await this.db.from("team_invites").delete().eq("team_id", teamId).eq("token", token)
        if (error) throw new RepositoryError(error.message, { cause: error })
    }
}

/** Composition seam: bind a TeamInvitesRepository to a specific Supabase client. */
export function createSupabaseTeamInvitesRepository(db: AnyDb): TeamInvitesRepository {
    return new SupabaseTeamInvitesRepository(db)
}
