// Shared server-side helpers for the public-issue session API. Every
// route that handles unauthenticated requests goes through these so
// the rules (token valid, session enabled, time-window open, issue
// belongs to the project, issue was filed publicly) live in one place.

import { jsonError } from "@/lib/api"
import { createServiceClient } from "@/lib/supabase/server"
import type { Issue, ProjectPublicSession } from "@/lib/supabase/types"

const PUBLIC_LABEL = "public-session"

export interface ResolvedPublicSession {
    project_id: string
    enabled: boolean
    start_at: string | null
    end_at: string | null
}

type SessionPick = Pick<ProjectPublicSession, "project_id" | "enabled" | "start_at" | "end_at">

// Resolve a token to a session row. Returns either a session or a
// pre-built error Response so callers can `if (e) return e`.
export async function resolvePublicSession(
    svc: ReturnType<typeof createServiceClient>,
    token: string,
    opts: { requireOpen: boolean },
): Promise<{ session: ResolvedPublicSession; error: null } | { session: null; error: Response }> {
    if (!token) return { session: null, error: jsonError("bad_request", "token required", 400) }
    const { data } = await svc
        .from("project_public_sessions")
        .select("project_id,enabled,start_at,end_at")
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
    return { session: data, error: null }
}

// Fetch an issue and confirm it (a) belongs to the session's project
// and (b) was filed via the public link (carries the public-session
// label). Together these ensure anonymous viewers can only see issues
// that were themselves submitted publicly — not the maintainer's
// internal/private issues.
export async function fetchPublicIssue(
    svc: ReturnType<typeof createServiceClient>,
    issueId: string,
    projectId: string,
): Promise<{ issue: Issue; error: null } | { issue: null; error: Response }> {
    const { data } = await svc
        .from("issues")
        .select("*")
        .eq("id", issueId)
        .maybeSingle<Issue>()
    if (!data || data.project_id !== projectId) {
        return { issue: null, error: jsonError("not_found", "issue not found", 404) }
    }
    if (!data.labels?.includes(PUBLIC_LABEL)) {
        return { issue: null, error: jsonError("not_found", "issue not found", 404) }
    }
    return { issue: data, error: null }
}

export const PUBLIC_ISSUE_LABEL = PUBLIC_LABEL
