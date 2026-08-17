// Teams application — the TeamMemberViews use-case. Merges member rows
// (user_id + role + created_at) with resolved auth profiles into the
// TeamMemberView shape the management UI renders. Depends only on the
// UserDirectory port (injected), so it stays runtime-agnostic; the concrete
// admin adapter is wired in Composition.ts.

import type { MemberRow, TeamMemberView, UserDirectory } from "../ports/UserDirectory"

export class TeamMemberViews {
    constructor(private readonly directory: UserDirectory) {}

    /** Enrich member rows with profiles → TeamMemberView[], preserving input order. */
    async build(rows: MemberRow[]): Promise<TeamMemberView[]> {
        const profiles = await this.directory.resolveProfiles(rows.map((r) => r.user_id))
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
}
