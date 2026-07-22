// Teams infrastructure — the Supabase admin UserDirectory adapter. The only place
// that reaches the auth.admin API to resolve profiles. Uses a SERVICE-ROLE client
// (auth.users is outside the tracker schema and unreadable by `authenticated`);
// the client is injected by the composition seam, not constructed here.

import type { SupabaseClient } from "@supabase/supabase-js"
import { Supabase } from "@/lib/server/supabase"
import type { UserDirectory, UserProfile } from "../ports/UserDirectory"

// The service-role client is "tracker"-schema-typed; accept any schema so the
// injected client is assignable (mirrors the other adapters).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = SupabaseClient<any, any, any>

export class SupabaseAdminUserDirectory implements UserDirectory {
    constructor(private readonly db: AnyDb) {}

    async resolveProfiles(userIds: string[]): Promise<Map<string, UserProfile>> {
        const unique = Array.from(new Set(userIds))
        const out = new Map<string, UserProfile>()
        await Promise.all(
            unique.map(async (id) => {
                try {
                    const { data } = await this.db.auth.admin.getUserById(id)
                    const u = data?.user
                    out.set(id, {
                        user_id: id,
                        email: u?.email ?? null,
                        name: this.metaName(u?.user_metadata),
                        avatar_url: (u?.user_metadata?.avatar_url as string) ?? null,
                    })
                } catch {
                    // A removed account (or a transient admin-API failure) still
                    // shows a row — resolve it to a null-filled profile.
                    out.set(id, { user_id: id, email: null, name: null, avatar_url: null })
                }
            }),
        )
        return out
    }

    private metaName(meta: Record<string, unknown> | undefined): string | null {
        return (meta?.full_name as string) || (meta?.name as string) || null
    }
}

/** Composition seam: the service-role-backed UserDirectory (auth.admin API). */
export function createServiceAdminUserDirectory(): UserDirectory {
    return new SupabaseAdminUserDirectory(Supabase.service())
}
