// Teams infrastructure — the Supabase adapter for TeamsRepository. The only place
// that queries the teams table (and the create_team RPC). Bound to the caller's
// RLS-scoped client, so every operation is scoped by the database.

import type { SupabaseClient } from "@supabase/supabase-js"
import { RepositoryError } from "@/lib/shared/kernel"
import type { Team } from "@/lib/shared/types"
import type { TeamsRepository } from "../ports/TeamsRepository"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = SupabaseClient<any, any, any>

export class SupabaseTeamsRepository implements TeamsRepository {
    constructor(private readonly db: AnyDb) {}

    async createTeam(name: string): Promise<string> {
        const { data, error } = await this.db.rpc("create_team", { p_name: name })
        if (error) throw new RepositoryError(error.message, { cause: error })
        return data as string
    }

    async findById(id: string): Promise<Team | null> {
        const { data, error } = await this.db.from("teams").select("*").eq("id", id).maybeSingle<Team>()
        if (error) throw new RepositoryError(error.message, { cause: error })
        return data ?? null
    }

    async isPersonal(id: string): Promise<boolean> {
        // Fail-safe: the original guard ignored the query error and treated an
        // absent/failed read as "not personal" (falls through to the update).
        const { data } = await this.db
            .from("teams")
            .select("is_personal")
            .eq("id", id)
            .maybeSingle<{ is_personal: boolean }>()
        return data?.is_personal ?? false
    }

    async rename(id: string, name: string): Promise<Team> {
        const { data, error } = await this.db.from("teams").update({ name }).eq("id", id).select("*").single<Team>()
        if (error) throw new RepositoryError(error.message, { cause: error })
        return data
    }

    async delete(id: string): Promise<void> {
        const { error } = await this.db.from("teams").delete().eq("id", id)
        if (error) throw new RepositoryError(error.message, { cause: error })
    }
}

/** Composition seam: bind a TeamsRepository to a specific Supabase client. */
export function createSupabaseTeamsRepository(db: AnyDb): TeamsRepository {
    return new SupabaseTeamsRepository(db)
}
