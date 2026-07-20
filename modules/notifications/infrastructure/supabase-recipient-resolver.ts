// Notifications infrastructure — the TEAM-AWARE RecipientResolver. This is the
// concrete fix for the single-owner gap: the old DB triggers notified only
// projects.user_id, so teammates and collection members heard nothing. Here we
// fan an event out to every team member who can actually see the project.
//
// It is the INVERSE of lib/auth/team-access.ts. That module answers "which
// projects may this user see?" (owner/admin ⇒ all; a plain member ⇒ only
// projects granted to a group they belong to). We answer the mirror question:
// "which team members may see THIS project?" — same owner/admin-vs-member rule,
// evaluated project-first.
//
// The caller injects a SERVICE-ROLE client: this is a server-to-server context
// (a DB-driven callback with no logged-in user) that must bypass RLS and reach
// the auth admin API to resolve emails — the same reason lib/email/notifications
// uses createServiceClient. We never construct a client here.
//
// FOLLOW-UP: there is no per-user channel-preferences store yet, so every
// recipient is returned with all channels ("in_app", "email"); the dispatcher
// still intersects that with each event's default channels. Once preferences
// exist, narrow `channels` per user here.

import type { SupabaseClient } from "@supabase/supabase-js"

import { createSupabaseProjectsRepository } from "@/modules/projects"
import type { NotificationEvent } from "../domain/events"
import type { ChannelId } from "../domain/events"
import type { Recipient, RecipientResolver } from "../ports/recipient-resolver"

// Loosely-typed client: the tracker schema types are hand-written, so `.from`
// results are cast to concrete row shapes at each call site (same convention as
// lib/auth/team-access.ts and the rest of the app).
type DB = SupabaseClient

type TeamRole = "owner" | "admin" | "member"

// Until a preferences store exists, every recipient gets every channel; the
// dispatcher narrows this to each event's default channels.
const ALL_CHANNELS: readonly ChannelId[] = ["in_app", "email"]

export function createSupabaseRecipientResolver(db: SupabaseClient): RecipientResolver {
    return {
        async resolve(event: NotificationEvent): Promise<Recipient[]> {
            // 1. The project's owning team. No team ⇒ nobody to notify.
            // Read through the Projects contract — notifications doesn't own the
            // projects table.
            const teamId = await createSupabaseProjectsRepository(db).findTeamId(event.projectId)
            if (!teamId) return []

            // 2. Every member of that team, with their role.
            const { data: memberRows, error: membersErr } = await db
                .from("team_members")
                .select("user_id,role")
                .eq("team_id", teamId)
            if (membersErr) throw new Error(membersErr.message)
            const members = (memberRows ?? []) as { user_id: string; role: TeamRole }[]

            // 3. The set of userIds to notify. Owners/admins always; a plain
            //    member only if the project is granted to a group they're in.
            const userIds = new Set<string>()
            const plainMembers = members.filter((m) => m.role !== "owner" && m.role !== "admin")
            for (const m of members) {
                if (m.role === "owner" || m.role === "admin") userIds.add(m.user_id)
            }

            if (plainMembers.length > 0) {
                const allowed = await resolveGroupMemberUserIds(db, teamId, event.projectId)
                for (const m of plainMembers) {
                    if (allowed.has(m.user_id)) userIds.add(m.user_id)
                }
            }

            // 4. Resolve each recipient's email (may be null — keep them anyway,
            //    the in-app channel still applies).
            const recipients: Recipient[] = []
            for (const userId of userIds) {
                const email = await resolveUserEmail(db, userId)
                recipients.push({ userId, email, channels: ALL_CHANNELS })
            }
            return recipients
        },
    }
}

// resolveGroupMemberUserIds returns the userIds of every team member who belongs
// to a group this project is granted to. Mirrors getAccessibleProjectIds in
// reverse: there we walk user → groups → projects; here we walk project →
// granting groups → member userIds.
async function resolveGroupMemberUserIds(db: DB, teamId: string, projectId: string): Promise<Set<string>> {
    const { data: gp, error: e1 } = await db
        .from("access_group_projects")
        .select("group_id")
        .eq("project_id", projectId)
    if (e1) throw new Error(e1.message)
    const groupIds = Array.from(new Set(((gp ?? []) as { group_id: string }[]).map((r) => r.group_id)))
    if (groupIds.length === 0) return new Set<string>()

    const { data: gm, error: e2 } = await db
        .from("access_group_members")
        .select("user_id")
        .in("group_id", groupIds)
        .eq("team_id", teamId)
    if (e2) throw new Error(e2.message)
    return new Set(((gm ?? []) as { user_id: string }[]).map((r) => r.user_id))
}

// resolveUserEmail looks up an auth.users email via the service-role admin API.
// There is no profiles mirror table — identity lives only in Supabase auth — so
// the admin endpoint is the way in (copied from lib/email/notifications.ts).
async function resolveUserEmail(db: DB, userId: string): Promise<string | null> {
    try {
        const { data, error } = await db.auth.admin.getUserById(userId)
        if (error) return null
        return data.user?.email ?? null
    } catch {
        return null
    }
}
