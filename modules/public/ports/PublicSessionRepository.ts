// Public port — persistence for the /p/<token> session gate. The reads the gate
// needs across the public_* tables, behind one role the PublicSessionService
// depends on. (Issue-by-id stays on the Issues contract; group coverage stays on
// the Teams contract — both consumed by the service, not duplicated here.)

import type { PublicSession } from "@/lib/shared/types"

/** The narrow public_sessions row the gate reads by token. */
export type PublicSessionRow = Pick<
    PublicSession,
    "id" | "enabled" | "access_mode" | "submissions_visibility" | "start_at" | "end_at" | "group_id"
>

/** An issue's public reporter row (who filed it, and their auth identity if any). */
export interface IssueReporter {
    reporter_id: string | null
    auth_user_id: string | null
}

export interface PublicSessionRepository {
    /** The session row for a /p/<token> link, or null if the token is unknown. */
    findByToken(token: string): Promise<PublicSessionRow | null>
    /** The manually-linked project ids for a (non-group) session. */
    listManualProjectIds(sessionId: string): Promise<string[]>
    /** The reporter row for an issue, or null when there is none. */
    findIssueReporter(issueId: string): Promise<IssueReporter | null>
    /** Whether `email` is on this session's invite whitelist. */
    hasInvite(sessionId: string, email: string): Promise<boolean>
}
