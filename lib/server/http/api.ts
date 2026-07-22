// Shared helpers for tracker API route handlers.
//
// This is the stable import surface (~89 route files import from here). It
// re-exports the pure response builders (./responses) and the ApiContext guard
// class + team constants (./ApiContext).
//
// The require* FREE FUNCTIONS below are thin delegators to ApiContext, kept so
// the guard extraction lands green without touching call sites; a follow-up commit
// retargets the routes to construct ApiContext directly and removes these.

import { ApiContext } from "./ApiContext"
import type { TeamRole } from "@/lib/shared/types"
import type {
    AuthOK, AuthFail, TeamOK, TeamFail, ProjectOK, ProjectFail, IssueOK, IssueFail, TeamRowOK, TeamRowFail,
} from "./ApiContext"

// ─── stable re-export surface ────────────────────────────────────────────────
export { jsonError, forbidden, repoRead } from "./responses"
export { ApiContext, TEAM_HEADER, TEAM_COOKIE, personalTeamName } from "./ApiContext"
export type {
    AuthOK, AuthFail, TeamOK, TeamFail, ProjectOK, ProjectFail, IssueOK, IssueFail, TeamRowOK, TeamRowFail,
} from "./ApiContext"

// ─── delegating guards (transitional — see file header) ──────────────────────
export function requireUser(): Promise<AuthOK | AuthFail> {
    return new ApiContext().requireUser()
}

/** Pass the Request so the x-team-id header is honoured; the `team_id` cookie is
 *  the fallback. */
export function requireTeam(request?: Request): Promise<TeamOK | TeamFail> {
    return new ApiContext(request).requireTeam()
}

export function requireRole(role: TeamRole, min: TeamRole): Response | null {
    return new ApiContext().requireRole(role, min)
}

export function requireProjectAccess(projectId: string): Promise<ProjectOK | ProjectFail> {
    return new ApiContext().requireProjectAccess(projectId)
}

export function requireIssueAccess(issueId: string): Promise<IssueOK | IssueFail> {
    return new ApiContext().requireIssueAccess(issueId)
}

export function requireCollectionAccess(id: string, opts?: { write?: boolean }): Promise<TeamRowOK | TeamRowFail> {
    return new ApiContext().requireCollectionAccess(id, opts)
}

export function requireSessionAccess(id: string, opts?: { write?: boolean }): Promise<TeamRowOK | TeamRowFail> {
    return new ApiContext().requireSessionAccess(id, opts)
}
