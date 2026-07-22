// Resolve auth-profile details (email / display name / avatar) for a set of
// user ids. auth.users lives outside the tracker schema and is not readable by
// the `authenticated` role, so this uses the service-role admin API. Callers
// MUST authorise first (e.g. confirm the requester is a member of the team whose
// members they're listing) — this helper does no access control of its own.

import { createServiceClient } from "@/lib/server/supabase"
import type { TeamMemberView, TeamRole } from "@/lib/shared/types"

export interface UserProfile {
    user_id: string
    email: string | null
    name: string | null
    avatar_url: string | null
}

function metaName(meta: Record<string, unknown> | undefined): string | null {
    return (meta?.full_name as string) || (meta?.name as string) || null
}

/** Map of user_id → profile. Missing users resolve to a null-filled profile so
 *  the caller always gets an entry (a removed account still shows a row). */
export async function resolveUserProfiles(userIds: string[]): Promise<Map<string, UserProfile>> {
    const svc = createServiceClient()
    const unique = Array.from(new Set(userIds))
    const out = new Map<string, UserProfile>()
    await Promise.all(
        unique.map(async (id) => {
            try {
                const { data } = await svc.auth.admin.getUserById(id)
                const u = data?.user
                out.set(id, {
                    user_id: id,
                    email: u?.email ?? null,
                    name: metaName(u?.user_metadata),
                    avatar_url: (u?.user_metadata?.avatar_url as string) ?? null,
                })
            } catch {
                out.set(id, { user_id: id, email: null, name: null, avatar_url: null })
            }
        }),
    )
    return out
}

/** Merge member rows (user_id + role + created_at) with resolved profiles into
 *  the TeamMemberView shape the management UI renders. */
export async function toMemberViews(
    rows: { user_id: string; role: TeamRole; created_at: string }[],
): Promise<TeamMemberView[]> {
    const profiles = await resolveUserProfiles(rows.map((r) => r.user_id))
    return rows.map((r) => {
        const p = profiles.get(r.user_id)
        return {
            user_id: r.user_id,
            role: r.role,
            email: p?.email ?? null,
            name: p?.name ?? null,
            avatar_url: p?.avatar_url ?? null,
            created_at: r.created_at,
        }
    })
}
