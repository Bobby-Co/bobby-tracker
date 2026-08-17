// Public infrastructure — the /p/<token> access gate. Owns the rules every
// unauthenticated public route goes through: token valid, session enabled,
// time-window open, project covered, issue filed publicly, 'own'-visibility,
// and invite-only enforcement. Each decision is asked of the PublicSession
// aggregate; the I/O is delegated to the injected ports.
//
// A boundary service (like vcs' CommentActions gate): it returns ready-to-send
// Response objects and reads the request-bound visitor, so it lives in
// infrastructure, not application. The composition root (../Composition) binds it
// to the three repositories.

import { jsonError } from "@/lib/server/http/api"
import { tryOrNull } from "@/lib/shared/kernel"
import type { Issue } from "@/lib/shared/types"
import type { IssuesRepository } from "@/modules/issues"
import type { TeamMembershipRepository } from "@/modules/teams"
import { PUBLIC_ISSUE_LABEL, PublicSession } from "../domain/PublicSession"
import type { PublicSessionRepository, PublicSessionRow } from "../ports/PublicSessionRepository"
import { CurrentVisitor } from "./CurrentVisitor"

/** A resolved session: the row plus the project ids it covers (derived from the
 *  group's public-enabled membership, or the manual junction). */
export type ResolvedPublicSession = PublicSessionRow & { project_ids: string[] }

export type InviteCheck =
    | { ok: true; email: string | null }
    /** Visitor is signed out and the session requires sign-in. */
    | { ok: false; reason: "unauthenticated" }
    /** Signed in but their email isn't on the whitelist. */
    | { ok: false; reason: "not_invited"; email: string }

export class PublicSessionService {
    private readonly visitor = new CurrentVisitor()

    constructor(
        private readonly sessions: PublicSessionRepository,
        private readonly issues: IssuesRepository,
        private readonly teams: TeamMembershipRepository,
    ) {}

    /** The team that owns a session — the party billed for AI a public visitor
     *  triggers. Public reporters are unauthenticated and may not belong to any
     *  team, so spend has to land on whoever published the link. Null when the
     *  ownership row is missing, which leaves the call unattributed rather than
     *  billed to the wrong team. */
    async ownerTeamId(sessionId: string): Promise<string | null> {
        const owner = await this.sessions.findOwnership(sessionId)
        return owner?.team_id ?? null
    }

    /** Resolve a token to a session (with covered project ids), or a pre-built
     *  error Response so callers can `if (e) return e`. */
    async resolve(
        token: string,
        opts: { requireOpen: boolean },
    ): Promise<{ session: ResolvedPublicSession; error: null } | { session: null; error: Response }> {
        if (!token) return { session: null, error: jsonError("bad_request", "token required", 400) }
        const data = await this.sessions.findByToken(token)
        if (!data) return { session: null, error: jsonError("not_found", "this submission link is invalid", 404) }
        if (!data.enabled) return { session: null, error: jsonError("not_found", "this submission link is inactive", 404) }
        if (opts.requireOpen) {
            const session = PublicSession.of(data)
            const now = Date.now()
            if (session.isBeforeStart(now)) {
                return { session: null, error: jsonError("window_closed", "submissions haven't opened yet", 403) }
            }
            if (session.isAfterEnd(now)) {
                return { session: null, error: jsonError("window_closed", "submissions are closed", 403) }
            }
        }

        // Group-backed session: pull the group's current membership filtered to
        // projects with public-submissions enabled (read through the Teams
        // contract). Otherwise the manual junction.
        const project_ids = data.group_id
            ? await this.teams.listPublicEnabledProjectIdsInGroup(data.group_id)
            : await this.sessions.listManualProjectIds(data.id)

        return { session: { ...data, project_ids }, error: null }
    }

    /** Fetch an issue and confirm it (a) belongs to a covered project and (b) was
     *  filed via a public link (carries the public-session label) — so anonymous
     *  viewers only ever see publicly-submitted issues, never private ones. */
    async fetchPublicIssue(
        issueId: string,
        sessionProjectIds: string[],
    ): Promise<{ issue: Issue; error: null } | { issue: null; error: Response }> {
        // Read through the Issues contract. Fail-safe: fold a query error to null
        // (→ 404), matching the original read that ignored the error.
        const data = await tryOrNull(() => this.issues.findById(issueId))
        if (!data || !sessionProjectIds.includes(data.project_id)) {
            return { issue: null, error: jsonError("not_found", "issue not found", 404) }
        }
        if (!data.labels?.includes(PUBLIC_ISSUE_LABEL)) {
            return { issue: null, error: jsonError("not_found", "issue not found", 404) }
        }
        return { issue: data, error: null }
    }

    /** Enforce 'own'-visibility on a per-issue lookup. Only rejects when the
     *  session is in 'own' mode AND the visitor is signed in AND the issue's
     *  reporter row doesn't carry their auth_user_id. */
    async requireOwnVisibility(
        session: Pick<ResolvedPublicSession, "submissions_visibility">,
        issueId: string,
    ): Promise<Response | null> {
        if (!PublicSession.of(session).showsOwnSubmissionsOnly()) return null
        const visitor = await this.visitor.current()
        if (!visitor) return null
        const rep = await this.sessions.findIssueReporter(issueId)
        if (rep?.auth_user_id && rep.auth_user_id === visitor.id) return null
        return jsonError("not_found", "issue not found", 404)
    }

    /** Decide whether the current request's visitor may act on this session.
     *  Link mode is always ok; invite mode requires a signed-in user whose email
     *  is whitelisted. The invite lookup goes through the service-role repository
     *  so RLS stays owner-only; the auth check is independent (cookie-bound). */
    async checkInviteAccess(session: Pick<ResolvedPublicSession, "id" | "access_mode">): Promise<InviteCheck> {
        if (PublicSession.of(session).isLinkAccess()) return { ok: true, email: null }

        const user = await this.visitor.current()
        if (!user) return { ok: false, reason: "unauthenticated" }

        const email = user.email ?? ""
        if (!email) return { ok: false, reason: "not_invited", email: "" }

        const invited = await this.sessions.hasInvite(session.id, email)
        if (!invited) return { ok: false, reason: "not_invited", email }
        return { ok: true, email }
    }

    /** API-route flavour of checkInviteAccess: a JSON error Response, or null when
     *  the visitor is allowed. */
    async requireInviteAccess(session: Pick<ResolvedPublicSession, "id" | "access_mode">): Promise<Response | null> {
        const check = await this.checkInviteAccess(session)
        if (check.ok) return null
        if (check.reason === "unauthenticated") {
            return jsonError("auth_required", "Sign in to access this submission link.", 401)
        }
        return jsonError("not_invited", "Your account isn't on this session's invite list.", 403)
    }
}
