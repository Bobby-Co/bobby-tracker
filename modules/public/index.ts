// Public bounded context — PUBLIC CONTRACT (see modules/README.md).
// The anonymous /p/<token> reporting surface: session/invite resolution + access
// gates, plus the reporter-grouping read-model. Browser-only reporter-identity
// storage lives with the client, in components/public/public-profile.ts.

// Reporter read-model (domain)
export type { PublicListedIssue, PublicParentRow, PublicReporterGroup } from "./domain/public-reporter"
export { reporterDisplay, groupByParent, groupParentsByReporter } from "./domain/public-reporter"

// Session / invite resolution + access gates
export type { ResolvedPublicSession, InviteCheck } from "./infrastructure/public-session"
export {
    PUBLIC_ISSUE_LABEL,
    resolvePublicSession,
    fetchPublicIssue,
    getCurrentPublicUser,
    getIssueReporter,
    requireOwnVisibility,
    checkInviteAccess,
    requireInviteAccess,
} from "./infrastructure/public-session"
