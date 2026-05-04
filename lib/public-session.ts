// Shared server-side helpers for the public-issue session API. Every
// route that handles unauthenticated requests goes through these so
// the rules (token valid, session enabled, time-window open, project
// covered by session, issue belongs to one of the covered projects,
// issue was filed publicly, invite-only access enforcement) live in
// one place.

import { jsonError } from "@/lib/api"
import { createServiceClient, getCurrentUser } from "@/lib/supabase/server"
import type {
    Issue,
    PublicSession,
    PublicSessionAccessMode,
    PublicSessionSubmissionsVisibility,
} from "@/lib/supabase/types"

const PUBLIC_LABEL = "public-session"

export interface ResolvedPublicSession {
    id: string
    enabled: boolean
    access_mode: PublicSessionAccessMode
    submissions_visibility: PublicSessionSubmissionsVisibility
    start_at: string | null
    end_at: string | null
    /** Project IDs this session covers. When the session is backed
     *  by a project group (group_id != null), this is the group's
     *  membership filtered to projects with the public-submissions
     *  integration enabled. Otherwise it's the manual junction. */
    project_ids: string[]
    /** Set when the session derives its coverage from a group. The
     *  public AI compose endpoint uses this to enable per-project
     *  routing via find_similar_projects. */
    group_id: string | null
}

type SessionPick = Pick<PublicSession,
    "id" | "enabled" | "access_mode" | "submissions_visibility" | "start_at" | "end_at" | "group_id">

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
        .select("id,enabled,access_mode,submissions_visibility,start_at,end_at,group_id")
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

    let project_ids: string[] = []
    if (data.group_id) {
        // Group-backed session: pull the group's current membership
        // and filter to projects that have the public-submissions
        // integration enabled. The integration trigger guards manual
        // adds to public_session_projects; for groups we apply the
        // same filter at read time so a project added to the group
        // before public-submissions is enabled doesn't get exposed.
        const { data: members } = await svc
            .from("project_group_members")
            .select("project_id,projects!inner(project_public_integration!inner(enabled))")
            .eq("group_id", data.group_id)
            .eq("projects.project_public_integration.enabled", true)
            .returns<{ project_id: string }[]>()
        project_ids = (members ?? []).map((r) => r.project_id)
    } else {
        const { data: links } = await svc
            .from("public_session_projects")
            .select("project_id")
            .eq("session_id", data.id)
            .returns<{ project_id: string }[]>()
        project_ids = (links ?? []).map((r) => r.project_id)
    }

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

// Read the current request's authenticated user (cookie-bound). Used
// at submission time to attribute the issue and at read time to
// enforce 'own'-visibility filters. Returns null for anonymous
// visitors — never throws.
export async function getCurrentPublicUser(): Promise<{ id: string; email: string | null } | null> {
    const user = await getCurrentUser()
    if (!user) return null
    return { id: user.id, email: (user.email ?? "").trim().toLowerCase() || null }
}

// ─── invite-only enforcement ─────────────────────────────────────────────

export type InviteCheck =
    | { ok: true; email: string | null }
    /** Visitor is signed out and the session requires sign-in. */
    | { ok: false; reason: "unauthenticated" }
    /** Signed in but their email isn't on the whitelist. */
    | { ok: false; reason: "not_invited"; email: string }

// Look up an issue's reporter row. Lightweight wrapper around the
// service client so 'own'-visibility callers don't need to know the
// table shape.
export async function getIssueReporter(
    svc: ReturnType<typeof createServiceClient>,
    issueId: string,
): Promise<{ reporter_id: string | null; auth_user_id: string | null } | null> {
    const { data } = await svc
        .from("public_issue_reporters")
        .select("reporter_id,auth_user_id")
        .eq("issue_id", issueId)
        .maybeSingle<{ reporter_id: string | null; auth_user_id: string | null }>()
    return data ?? null
}

// Enforce 'own'-visibility on a per-issue lookup. Only ever rejects
// when the session is in 'own' mode AND the visitor is signed in
// AND the issue's reporter row doesn't carry their auth_user_id.
//
// Anonymous visitors on a link-mode 'own' session aren't blocked
// here: we can't identify them server-side without trusting a
// client-supplied reporter id, and the listing already filters them
// down. The per-issue URL is an unguessable UUID, so this matches
// the threat model of 'own' in link mode (privacy preference, not
// hard boundary).
export async function requireOwnVisibility(
    svc: ReturnType<typeof createServiceClient>,
    session: Pick<ResolvedPublicSession, "submissions_visibility">,
    issueId: string,
): Promise<Response | null> {
    if (session.submissions_visibility !== "own") return null
    const visitor = await getCurrentPublicUser()
    if (!visitor) return null
    const rep = await getIssueReporter(svc, issueId)
    if (rep?.auth_user_id && rep.auth_user_id === visitor.id) return null
    return jsonError("not_found", "issue not found", 404)
}

// Decide whether the *current request's* visitor is allowed to act on
// this session. Link-mode sessions are always ok. Invite-mode sessions
// require a signed-in user whose lowercased email matches a row in
// public_session_invites. We always look up the invite row through the
// service client so RLS can stay locked to owner-only — the auth check
// is performed independently against the cookie-bound client.
export async function checkInviteAccess(
    session: Pick<ResolvedPublicSession, "id" | "access_mode">,
): Promise<InviteCheck> {
    if (session.access_mode === "link") return { ok: true, email: null }

    const user = await getCurrentPublicUser()
    if (!user) return { ok: false, reason: "unauthenticated" }

    const email = user.email ?? ""
    if (!email) return { ok: false, reason: "not_invited", email: "" }

    const svc = createServiceClient()
    const { data: invite } = await svc
        .from("public_session_invites")
        .select("email")
        .eq("session_id", session.id)
        .eq("email", email)
        .maybeSingle<{ email: string }>()
    if (!invite) return { ok: false, reason: "not_invited", email }
    return { ok: true, email }
}

// API-route flavour: turn an invite check into a JSON error Response,
// or null if the visitor is allowed.
export async function requireInviteAccess(
    session: Pick<ResolvedPublicSession, "id" | "access_mode">,
): Promise<Response | null> {
    const check = await checkInviteAccess(session)
    if (check.ok) return null
    if (check.reason === "unauthenticated") {
        return jsonError(
            "auth_required",
            "Sign in to access this submission link.",
            401,
        )
    }
    return jsonError(
        "not_invited",
        "Your account isn't on this session's invite list.",
        403,
    )
}
