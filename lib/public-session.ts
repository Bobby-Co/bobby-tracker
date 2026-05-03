// Shared server-side helpers for the public-issue session API. Every
// route that handles unauthenticated requests goes through these so
// the rules (token valid, session enabled, time-window open, project
// covered by session, issue belongs to one of the covered projects,
// issue was filed publicly) live in one place.

import { jsonError } from "@/lib/api"
import { createServiceClient } from "@/lib/supabase/server"
import type { Issue, PublicSession } from "@/lib/supabase/types"

const PUBLIC_LABEL = "public-session"

export interface ResolvedPublicSession {
    id: string
    enabled: boolean
    start_at: string | null
    end_at: string | null
    /** Project IDs this session covers. */
    project_ids: string[]
}

type SessionPick = Pick<PublicSession, "id" | "enabled" | "start_at" | "end_at">

// Resolve a token to a session row. Returns either a session (with
// the list of covered project IDs) or a pre-built error Response so
// callers can `if (e) return e`.
export async function resolvePublicSession(
    svc: ReturnType<typeof createServiceClient>,
    token: string,
    opts: { requireOpen: boolean },
): Promise<{ session: ResolvedPublicSession; error: null } | { session: null; error: Response }> {
    if (!token) return { session: null, error: jsonError("bad_request", "token required", 400) }
    const { data } = await svc
        .from("public_sessions")
        .select("id,enabled,start_at,end_at")
        .eq("token", token)
        .maybeSingle<SessionPick>()
    if (!data) return { session: null, error: jsonError("not_found", "this submission link is invalid", 404) }
    if (!data.enabled) return { session: null, error: jsonError("not_found", "this submission link is inactive", 404) }
    if (opts.requireOpen) {
        const now = Date.now()
        if (data.start_at && Date.parse(data.start_at) > now) {
            return { session: null, error: jsonError("window_closed", "submissions haven't opened yet", 403) }
        }
        if (data.end_at && Date.parse(data.end_at) <= now) {
            return { session: null, error: jsonError("window_closed", "submissions are closed", 403) }
        }
    }

    const { data: links } = await svc
        .from("public_session_projects")
        .select("project_id")
        .eq("session_id", data.id)
        .returns<{ project_id: string }[]>()
    const project_ids = (links ?? []).map((r) => r.project_id)

    return { session: { ...data, project_ids }, error: null }
}

// Fetch an issue and confirm it (a) belongs to one of the projects
// the session covers and (b) was filed via a public link (carries
// the public-session label). Together these ensure anonymous viewers
// can only see issues that were themselves submitted publicly — not
// the maintainer's internal/private issues.
export async function fetchPublicIssue(
    svc: ReturnType<typeof createServiceClient>,
    issueId: string,
    sessionProjectIds: string[],
): Promise<{ issue: Issue; error: null } | { issue: null; error: Response }> {
    const { data } = await svc
        .from("issues")
        .select("*")
        .eq("id", issueId)
        .maybeSingle<Issue>()
    if (!data || !sessionProjectIds.includes(data.project_id)) {
        return { issue: null, error: jsonError("not_found", "issue not found", 404) }
    }
    if (!data.labels?.includes(PUBLIC_LABEL)) {
        return { issue: null, error: jsonError("not_found", "issue not found", 404) }
    }
    return { issue: data, error: null }
}

export const PUBLIC_ISSUE_LABEL = PUBLIC_LABEL
