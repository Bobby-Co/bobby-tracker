// The PublicSession domain aggregate — a public /p/<token> submission session.
//
// It owns the session's OPEN-window + ACCESS rules that previously lived inline in
// the infrastructure resolver (public-session.ts): the start/end time window, the
// link-vs-invite access mode, and the own-vs-all submissions visibility. Lifting
// them here makes them named, tested domain behaviour instead of conditionals
// buried in an I/O function.
//
// Pure domain: no I/O, framework, or SDK. Enum values are kept local (drift-
// guarded against the DB enums in ../infrastructure).

export type PublicSessionAccessModeValue = "link" | "invite"
export type PublicSessionSubmissionsVisibilityValue = "all" | "own"

/** The label every publicly-filed issue carries, so anonymous viewers only ever
 *  see issues submitted through a public link — never the maintainer's private
 *  ones. A public-session domain constant (the gate filters reads on it). */
export const PUBLIC_ISSUE_LABEL = "public-session"

/** The session state the rules read. Fields optional so the aggregate builds from
 *  the narrow projections the gates pass (some inspect only access_mode). */
export interface PublicSessionState {
    access_mode?: PublicSessionAccessModeValue
    submissions_visibility?: PublicSessionSubmissionsVisibilityValue
    start_at?: string | null
    end_at?: string | null
}

export class PublicSession {
    private constructor(private readonly s: PublicSessionState) {}

    static of(state: PublicSessionState): PublicSession {
        return new PublicSession(state)
    }

    /** Submissions haven't opened yet (a start time is set and still in the future). */
    isBeforeStart(now: number): boolean {
        return this.s.start_at != null && Date.parse(this.s.start_at) > now
    }

    /** Submissions have closed (an end time is set and has passed). */
    isAfterEnd(now: number): boolean {
        return this.s.end_at != null && Date.parse(this.s.end_at) <= now
    }

    /** Within the open window (or no window set). */
    isOpen(now: number): boolean {
        return !this.isBeforeStart(now) && !this.isAfterEnd(now)
    }

    /** Anyone with the link may submit (no per-visitor invite gate). */
    isLinkAccess(): boolean {
        return this.s.access_mode === "link"
    }

    isInviteOnly(): boolean {
        return this.s.access_mode === "invite"
    }

    /** A visitor sees only their OWN submissions (vs everyone's). */
    showsOwnSubmissionsOnly(): boolean {
        return this.s.submissions_visibility === "own"
    }
}
