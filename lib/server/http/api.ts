// Shared helpers for tracker API route handlers — the stable import surface the
// routes use (~89 files import from here).
//
// Request authorization lives on the ApiContext guard class (./ApiContext): a
// route constructs `new ApiContext(request)` and calls requireUser / requireTeam /
// requireProjectAccess / requireIssueAccess / requireCollectionAccess /
// requireSessionAccess / requireRole. The pure response builders (jsonError /
// forbidden / repoRead) live in ./responses. Both are re-exported here.

export { jsonError, forbidden, repoRead } from "./responses"
export { ApiContext, TEAM_HEADER, TEAM_COOKIE, personalTeamName } from "./ApiContext"
export type { RequestContext } from "./RequestContext"
export type {
    AuthSuccess, AuthFailure, TeamSuccess, TeamFailure, ProjectSuccess, ProjectFailure, IssueSuccess, IssueFailure, TeamRowSuccess, TeamRowFailure,
} from "./ApiContext"
