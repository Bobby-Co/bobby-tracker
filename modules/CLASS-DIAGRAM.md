# bobby-tracker — one class diagram, all subsystems

A single UML class diagram of the whole backend: the shared kernel, the Next host's
interface layer, the server platform seam, all thirteen bounded contexts under
`modules/`, the client runtime, and the external systems they speak to.

Everything drawn here exists in the code. Relationships are read off constructors,
`implements` clauses and imports — not inferred from the folder names.

## How to read it

| Notation | Meaning in this codebase |
| --- | --- |
| `<<interface>>` | A **port** — declared in `modules/<ctx>/ports/`, implemented in `infrastructure/` |
| `<<composition>>` | A **composition seam** (`Composition.ts`) — the only place a concrete adapter name appears at a call site; returns the *port* type |
| `<<route>>` | The **inbound interface layer** — Next route handlers in `app/api/**` (thin controllers: parse → authorize → delegate) |
| `<<external>>` | A system outside this process |
| `..|>` | **realization** — `class X implements Port` |
| `o--` | **aggregation** — constructor-injected `private readonly` collaborator |
| `*--` | **composition** — an owned field the class news up itself (`private readonly x = new X()`) |
| `..>` | **dependency** — calls / constructs / maps, but doesn't hold |
| `-->` | **association** — holds a reference or reads through it |

The dependency rule points inward everywhere: `route → application → domain`,
`infrastructure` implements `ports`, and `domain` depends on nothing but itself and
the kernel's pure types (enforced by the `no-restricted-imports` boundary rule in
[eslint.config.mjs](../eslint.config.mjs)).

### Which subsystem a class belongs to

Every class carries a `:::<subsystem>` tag on its declaration — `class VcsAppService:::vcs`
— and the classes are declared grouped under `%% ── <Subsystem>` markers in the source.

| Tag | Subsystem | Tag | Subsystem |
| --- | --- | --- | --- |
| `kernel` | `lib/shared/kernel/` | `vcs` | `modules/vcs/` |
| `shared` | `lib/shared/` | `analysis` | `modules/analysis/` |
| `platform` | `lib/server/` | `notify` | `modules/notifications/` |
| `route` | `app/api/**` | `public` | `modules/public/` |
| `client` | `lib/client/` | `relay` | `modules/relay/` |
| `access` | `modules/access/` | `billing` | `modules/billing/` |
| `teams` | `modules/teams/` | `mcp` · `mcpsrv` · `mcpauth` | `modules/mcp*/` |
| `projects` | `modules/projects/` | `external` | outside this process |
| `issues` | `modules/issues/` | | |

> **Why tags and not `namespace` blocks.** The first cut of this diagram grouped the
> classes into 19 mermaid `namespace` blocks. At this scale that reliably crashes
> mermaid's cluster layout (`dagre` throws `Cannot set properties of undefined
> (setting 'order')`) — verified by bisection: identical content renders fine flat and
> fails the moment the namespaces are added. The `classDef` fills above are declared
> for the day mermaid honours them in class diagrams; today (11.16) it emits the CSS
> class on each node but not the fill, so a viewer can colour the nodes with its own
> stylesheet while plain renderers show the diagram monochrome.

---

```mermaid
classDiagram
direction LR

%% subsystem colour key — see the legend under the diagram
classDef kernel fill:#E3E9EA,stroke:#57696C,color:#101718
classDef shared fill:#EDEFEF,stroke:#7C8C8F,color:#101718
classDef platform fill:#DBE7EC,stroke:#3F6E7E,color:#101718
classDef route fill:#F1E1D4,stroke:#A8541F,color:#101718
classDef access fill:#E6E1F3,stroke:#584CA0,color:#101718
classDef teams fill:#DBEAF3,stroke:#2B6B90,color:#101718
classDef projects fill:#DAEBE1,stroke:#2C6E46,color:#101718
classDef issues fill:#E9F1D6,stroke:#57701C,color:#101718
classDef vcs fill:#F6E6CB,stroke:#98630F,color:#101718
classDef analysis fill:#FBE2DA,stroke:#B0472A,color:#101718
classDef notify fill:#F8E0EC,stroke:#9A3668,color:#101718
classDef public fill:#DEEFEE,stroke:#26746F,color:#101718
classDef relay fill:#E9E9D8,stroke:#6C6C33,color:#101718
classDef billing fill:#F4E7D0,stroke:#89681D,color:#101718
classDef mcp fill:#E1E9F6,stroke:#38589A,color:#101718
classDef mcpsrv fill:#DCE5F8,stroke:#2B489E,color:#101718
classDef mcpauth fill:#E5E0F0,stroke:#564697,color:#101718
classDef client fill:#F0E5F1,stroke:#77527D,color:#101718
classDef external fill:#D6DBDC,stroke:#374244,color:#101718

%% SHARED KERNEL — lib/shared/kernel (pure; no Next, no SDK)
%% SharedKernel
class Result:::kernel {
 <<value>>
 +ok(value) Result
 +err(error) Result
}
class DomainError:::kernel {
 +string code
 +string name
}
class RepositoryError:::kernel {
 +string name
 +tryOrNull(fn) T
}
class DomainEvent:::kernel {
 <<interface>>
 +string type
 +string occurredAt
 +unknown payload
}
class EventBus:::kernel {
 <<interface>>
 +publish(event) void
 +subscribe(type, handler) Unsubscribe
}
class InProcessEventBus:::kernel {
 -Map handlers
 +publish(event) void
 +subscribe(type, handler) Unsubscribe
}
class Clock:::kernel {
 <<interface>>
 +now() Date
 +isoNow() string
}
class BackgroundTasks:::kernel {
 <<interface>>
 +run(task) void
}
class IdGenerator:::kernel {
 <<interface>>
 +uuid() string
}
class SystemClock:::kernel
class WorkersBackgroundTasks:::kernel
class CryptoIdGenerator:::kernel

%% SHARED RUNTIME — lib/shared (both sides of the wire)
%% SharedRuntime
class FindingState:::shared {
 <<utility>>
 +findingState(severity) FindingState
}
class Badge:::shared {
 <<utility>>
 +mergeVerdictLabel(v) string
}
class DbRowTypes:::shared {
 <<types>>
 +Project
 +Issue
 +PullRequest
 +Team
 +Notification
}
class RealtimeChannels:::shared {
 <<utility>>
}
class Iconly:::shared {
 <<utility>>
}

%% SERVER PLATFORM — lib/server (the request seam)
%% ServerPlatform
class ApiContext:::platform {
 -SessionGateway session
 -Request request
 +requireUser() AuthResult
 +requireTeam() TeamResult
 +requireRole(role, min) Response
 +requireProjectAccess(projectId) ProjectResult
 +requireIssueAccess(issueId) IssueResult
 +requireCollectionAccess(id, opts) TeamRowResult
 +requireSessionAccess(id, opts) TeamRowResult
 -requireTeamRowAccess(table, id, opts) TeamRowResult
}
class RequestContext:::platform {
 <<unit of work>>
 -SupabaseRlsClient db
 +access AccessService
 +projects ProjectsRepository
 +issues IssuesRepository
 +issueComments IssueCommentsReadRepository
 +projectDisplay ProjectDisplayRepository
 +analyser ProjectAnalyserRepository
 +githubTokens GithubTokenRepository
 +providerTokens ProviderTokenRepository
 +pullRequests PullRequestReadRepository
 +teamMembership TeamMembershipRepository
 +teams TeamsRepository
 +teamInvites TeamInvitesRepository
 +accessGroups AccessGroupsRepository
 +collections CollectionsRepository
 +publicSessions PublicSessionRepository
 +sessionsAdmin PublicSessionAdminRepository
 +publicIntegration ProjectPublicIntegrationRepository
 +mcpIntegration ProjectMcpIntegrationRepository
 +relayWorkers RelayWorkerRepository
 +notifications NotificationFeedRepository
 +subscriptions SubscriptionsRepository
 +usage UsageRepository
 +client SupabaseRlsClient
}
class SessionGateway:::platform {
 <<interface>>
 +currentUser() User
 +openContext() RequestContext
}
class SupabaseSessionGateway:::platform
class Supabase:::platform {
 <<seam>>
 +rls()$ SupabaseRlsClient
 +service()$ SupabaseServiceClient
 +currentUser()$ User
}
class AuthJwt:::platform {
 +decodeFromCookies(cookies) DecodedSession
 +isFresh(decoded, buffer) bool
 -readAuthCookieValue(cookies) string
 -decodeJwtPayload(jwt) Payload
}
class RateLimiter:::platform {
 +check(binding, key) Response
}
class EmailTransport:::platform {
 +isConfigured() bool
 +send(msg) void
}
class HttpResponses:::platform {
 <<utility>>
 +jsonError(code, msg, status) Response
 +forbidden(msg) Response
 +repoRead(fn) ReadOutcome
}

%% INTERFACE LAYER — app/api/** route handlers
%% InterfaceLayer
class IssuesApi:::route {
 <<route>>
 +POST /api/issues
 +PATCH /api/issues/[id]
 +POST /api/issues/[id]/analyse
}
class ProjectsApi:::route {
 <<route>>
 +CRUD /api/projects
 +POST /api/projects/[id]/analyser/index
}
class PullsApi:::route {
 <<route>>
 +GET /api/projects/[id]/pulls
 +POST .../[number]/merge
 +POST .../[number]/review
}
class CommentsApi:::route {
 <<route>>
 +CRUD issue + pr comments
}
class GithubWebhookRoute:::route {
 <<route>>
 +POST /api/webhooks/github
}
class GitlabWebhookRoute:::route {
 <<route>>
 +POST /api/webhooks/gitlab
}
class AnalysisCallbackApi:::route {
 <<route>>
 +POST /api/internal/analysis-result
 +POST /api/internal/pr-analysis-result
}
class NotificationsApi:::route {
 <<route>>
 +GET /api/notifications
 +POST /api/internal/notifications/drain
 +POST /api/internal/notification-email
}
class TeamsApi:::route {
 <<route>>
 +CRUD teams, members, groups, invites
}
class GroupsApi:::route {
 <<route>>
 +CRUD /api/groups (Collections)
 +POST /api/groups/[id]/ai-compose
}
class SessionsApi:::route {
 <<route>>
 +CRUD /api/sessions
}
class PublicApi:::route {
 <<route>>
 +POST /api/public-issues
}
class RelayApi:::route {
 <<route>>
 +POST /api/relay/pair/*
 +CRUD /api/relay/workers
}
class BillingApi:::route {
 <<route>>
 +GET /api/billing/balance
}
class McpApi:::route {
 <<route>>
 +POST /api/mcp
 +GET /api/mcp (SSE)
}
class OAuthApi:::route {
 <<route>>
 +POST /api/oauth/register
 +POST /api/oauth/token
 +POST /api/oauth/revoke
 +GET /.well-known/oauth-*
}

%% ACCESS — authorization policy (owns no tables)
%% AccessModule
class Role:::access {
 <<value object>>
 -TeamRoleValue role
 +of(value)$ Role
 +atLeast(min) bool
 +value TeamRoleValue
}
class AccessPolicy:::access {
 +scopeForRole(role, grantedIds) ProjectScope
 +allows(scope, projectId) bool
}
class AccessService:::access {
 -ProjectsRepository projects
 -TeamMembershipRepository teams
 -AccessPolicy policy
 +listTeams(userId, personalName) TeamWithRoleList
 +resolveActiveTeam(userId, requested, name) TeamWithRole
 +teamRole(teamId, userId) TeamRoleValue
 +accessibleProjectIds(teamId, userId, role) ProjectScope
 +canAccessProject(userId, projectId) ProjectAccess
}
class AccessComposition:::access {
 <<composition>>
 +getAccessService(db) AccessService
}

%% TEAMS — teams, memberships, people-groups, Collections, invites
%% TeamsModule
class Invite:::teams {
 <<value object>>
 +newToken() string
 +acceptUrl(request, token) string
}
class Email:::teams {
 <<value object>>
 +of(raw)$ Email
 +value string
 +isValid() bool
}
class TeamMemberViews:::teams {
 -UserDirectory directory
 +build(rows) TeamMemberViewList
}
class TeamsRepository:::teams {
 <<interface>>
 +createTeam(name) string
 +findById(id) Team
 +findName(id) string
 +isPersonal(id) bool
 +rename(id, name) Team
 +delete(id) void
}
class TeamMembershipRepository:::teams {
 <<interface>>
 +listTeamMembers(teamId) TeamMemberList
 +listUserTeams(userId) TeamWithRoleList
 +findTeamRole(teamId, userId) TeamRole
 +listUserGroupIds(teamId, userId) IdList
 +listProjectIdsForGroups(groupIds) IdList
 +listGroupIdsForProject(projectId) IdList
 +listGroupMemberUserIds(teamId, groupIds) IdList
 +listPublicEnabledProjectIdsInGroup(groupId) IdList
 +ensurePersonalTeam(userId, name) void
 +findCollectionOwnership(id) Ownership
 +listDetailed(teamId) TeamMemberDetailList
 +updateMemberRole(teamId, userId, role) MemberWriteResult
 +removeMember(teamId, userId) MemberWriteResult
}
class TeamInvitesRepository:::teams {
 <<interface>>
 +listPending(teamId) TeamInviteList
 +create(input) InviteCreateResult
 +revoke(teamId, token) void
}
class AccessGroupsRepository:::teams {
 <<interface>>
 +listForTeam(teamId) AccessGroupList
 +listMembers(groupIds) MemberLinkList
 +listProjectGrants(groupIds) ProjectLinkList
 +create(teamId, name, desc, by) AccessGroup
 +addMember(groupId, teamId, userId) LinkWriteResult
 +grantProject(groupId, teamId, projectId) LinkWriteResult
 +revokeProject(groupId, projectId) void
}
class CollectionsRepository:::teams {
 <<interface>>
 +listForTeam(teamId) ProjectGroupList
 +listMembers(groupId) CollectionMemberList
 +create(teamId, userId, name, desc) ProjectGroup
 +addMember(groupId, projectId) CollectionMemberResult
 +removeMember(groupId, projectId) void
}
class UserDirectory:::teams {
 <<interface>>
 +resolveProfiles(userIds) UserProfileMap
}
class InviteNotifier:::teams {
 <<interface>>
 +sendInvite(message) void
}
class SupabaseTeamsRepository:::teams
class SupabaseTeamMembershipRepository:::teams
class SupabaseTeamInvitesRepository:::teams
class SupabaseAccessGroupsRepository:::teams
class SupabaseCollectionsRepository:::teams
class SupabaseAdminUserDirectory:::teams
class JmapInviteNotifier:::teams
class TeamsComposition:::teams {
 <<composition>>
 +createInviteNotifier() InviteNotifier
 +createTeamMemberViews() TeamMemberViews
}

%% PROJECTS — the project aggregate + its tile read-model
%% ProjectsModule
class Project:::projects {
 <<aggregate>>
 -ProjectSyncState state
 +of(state)$ Project
 +isSyncReady() bool
 +allowsInbound() bool
 +allowsOutbound() bool
 +propagatesDeletes() bool
}
class ProjectInsight:::projects {
 <<aggregate>>
 +URGENT_WINDOW_MS$ number
 +PR_WINDOW_MS$ number
 +of(state)$ ProjectInsight
 +status(now) ProjectStatus
 -age(ts, now) number
}
class ProjectsRepository:::projects {
 <<interface>>
 +findGithubSyncContext(projectId) GithubSyncContext
 +findTeamId(projectId) string
 +findAnalysisContext(projectId) AnalysisProjectContext
 +findFull(projectId) Project
 +listForTeam(teamId, scope) ProjectList
 +listForTeamWithInsight(teamId, scope) ProjectWithInsightList
 +create(input) ProjectCreateResult
 +update(projectId, patch) Project
 +delete(projectId) void
 +updateSyncSettings(projectId, patch) GithubSyncSettings
 +linkGithub(projectId, installId, repoId) GithubLink
 +findSimilarProjects(embedding, ids, limit) ProjectSimilarityList
}
class ProjectDisplayRepository:::projects {
 <<interface>>
 +listLabelIcons(projectId) LabelIconList
 +upsertLabelIcon(projectId, label, icon, color) ProjectLabelIcon
 +listStatusColors(projectId) StatusColorList
 +upsertStatusColor(projectId, status, color) ProjectStatusColor
}
class SupabaseProjectsRepository:::projects
class SupabaseProjectDisplayRepository:::projects

%% ISSUES — the issue aggregate, its repos, and the embedding index
%% IssuesModule
class Issue:::issues {
 <<aggregate>>
 -IssueState state
 +of(state)$ Issue
 +statusFromGithubState(state)$ IssueStatusValue
 +isClosed() bool
 +isOpen() bool
 +githubState() VcsIssueState
 +isLinkedToGithub() bool
}
class EmbeddingText:::issues {
 +forIssue(issue) string
 +forRouting(proposal) string
}
class IssueEmbedder:::issues {
 -Analyser analyser
 -EmbeddingIndex index
 -EmbeddingText text
 +embedIssue(issue) void
 +countUnembedded(projectId) number
 +ensureEmbeddings(projectId, limit) number
}
class IssuePrompt:::issues {
 +compose(input) string
}
class IssuesRepository:::issues {
 <<interface>>
 +findProjectId(issueId) string
 +findById(issueId) Issue
 +findSuggestContext(issueId) IssueSuggestContext
 +findDuplicateGuardRows(ids) GuardRowList
 +create(issue) Issue
 +update(issueId, patch) Issue
 +deleteById(issueId) void
 +findLatestSuggestion(issueId) IssueSuggestion
 +insertSuggestion(row) IssueSuggestion
 +findSimilarityState(issueId, limit) IssueSimilarityState
 +listForProject(projectId, limit) IssueList
 +listAcrossProjects(projectIds, limit) IssueList
}
class EmbeddingIndex:::issues {
 <<interface>>
 +upsert(row) void
 +findUnembedded(projectId, limit) UnembeddedIssueList
 +countUnembedded(projectId) number
}
class IssueCommentsReadRepository:::issues {
 <<interface>>
 +listComments(projectId, issueNumber) IssueCommentList
 +findCommentOwnership(projectId, ghId) IssueCommentOwnership
}
class IssueSyncStore:::issues {
 <<interface>>
 +findAnalysisRow(issueId) IssueAnalysisRow
 +listLinkedGithubNumbers(projectId) NumberList
 +updateSyncFields(issueId, patch) void
 +insertImportedIssue(row) bool
 +countSuggestions(issueId) number
 +insertSuggestion(row) void
 +upsertComment(projectId, comment) void
 +deleteComment(projectId, commentId) void
}
class SupabaseIssuesRepository:::issues
class SupabaseEmbeddingIndex:::issues
class SupabaseIssueCommentsReadRepository:::issues
class ServiceIssueSyncStore:::issues
class IssuesComposition:::issues {
 <<composition>>
 +createIssueEmbedder() IssueEmbedder
 +createServiceIssueSyncStore() IssueSyncStore
 +createServiceEmbeddingIndex() EmbeddingIndex
}

%% VCS — the golden-standard module: provider-agnostic git hosting
%% VcsModule
class PullRequest:::vcs {
 <<aggregate>>
 -PullRequestState s
 +of(state)$ PullRequest
 +isMerged() bool
 +isClosed() bool
 +isDraft() bool
 +isOpen() bool
 +lifecycle() PullRequestLifecycle
}
class MergePolicy:::vcs {
 +criticalFindingCount(analysis) number
 +evaluate(pull, analysis) MergeGate
 +defaultMethod(methods) MergeMethod
}
class RepoRef:::vcs {
 <<value object>>
 +of(fields)$ RepoRef
 +fullName() string
 +blobUrl(file, line, sha) string
 -host() string
}
class SyncHash:::vcs {
 +compute(title, body, state) string
}
class VcsAppInstance:::vcs {
 <<interface>>
 +createIssue(input) VcsIssueRef
 +updateIssue(number, patch) void
 +deleteIssue(ref) void
 +listIssues(opts) VcsIssueList
 +createIssueComment(issueNumber, body) CommentId
 +updateIssueComment(issueNumber, id, body) void
 +listIssueComments(issueNumber) VcsCommentList
 +createPullRequestComment(prNumber, body) CommentId
 +updatePullRequestComment(prNumber, id, body) void
 +listPullRequestComments(prNumber) VcsCommentList
 +listPullRequests(opts) VcsPullRequestList
 +listPullRequestFiles(number) VcsFileList
 +listPullRequestReviews(number) VcsReviewList
 +getMergeMethods() VcsMergeMethods
 +getMergeability(number) VcsMergeability
 +mergePullRequest(number, input) VcsMergeResult
}
class VcsUserInstance:::vcs {
 <<interface>>
 +createComment(issueNumber, body) VcsComment
 +updateComment(issueNumber, id, body) VcsComment
 +deleteComment(issueNumber, id) void
}
class WebhookVerifier:::vcs {
 <<interface>>
 +verify(rawBody, signature) bool
}
class PullRequestStore:::vcs {
 <<interface>>
 +upsertPullRequest(projectId, pr) void
 +upsertComment(projectId, comment) void
 +deleteComment(projectId, source, id) void
 +markMerged(projectId, prNumber, at) void
 +findAnalysisResult(projectId, prNumber) PrAnalysis
}
class PullRequestReadRepository:::vcs {
 <<interface>>
 +listForProject(projectId) PullRequestList
 +listAnalysisStatuses(projectId) StatusList
 +findByNumber(projectId, prNumber) PullRequest
 +findAnalysis(projectId, prNumber) PullRequestAnalysis
 +listComments(projectId, prNumber) PrCommentList
 +findCommentOwnership(projectId, ghId) CommentOwnership
}
class GithubTokenRepository:::vcs {
 <<interface>>
 +find(userId) UserGithub
 +findAccess(userId) TokenAccess
 +remove(userId) void
}
class ProviderTokenRepository:::vcs {
 <<interface>>
 +list(userId) GitlabConnectionList
 +find(userId, host) UserProviderToken
 +upsert(userId, host, token) void
 +remove(userId, host) void
}
class VcsAppService:::vcs {
 -VcsAppInstance vcs
 -IssueSyncStore sync
 -SyncHash syncHash
 +syncIssueCreated(issue, project) void
 +syncIssueUpdated(issue, project, changed) void
 +syncIssueDeleted(issue, project) void
 +importIssues(ctx, project) ImportSummary
 +postComment(issueNumber, body) CommentId
 +updateComment(issueNumber, id, body) void
 +postPrComment(prNumber, body) CommentId
 +updatePrComment(prNumber, id, body) void
 +listPullRequestFiles(number) VcsFileList
 +getMergeMethods() VcsMergeMethods
 +getMergeability(number) VcsMergeability
 +mergePullRequest(number, input) VcsMergeResult
}
class VcsUserService:::vcs {
 -VcsUserInstance vcs
 +createComment(issueNumber, body) VcsComment
 +updateComment(issueNumber, id, body) VcsComment
 +deleteComment(issueNumber, id) void
}
class PullRequestService:::vcs {
 -VcsAppInstance vcs
 -PullRequestStore store
 -IssueCommentSink issueComments
 +backfillPullRequests(projectId) void
 +backfillPullRequestComments(projectId, prNumber) void
 +backfillIssueComments(projectId, issueNumber) void
 -syncComments(projectId, prNumber) void
}
class GithubAppClient:::vcs {
 +fetch(installationId, path, init) Response
 +jwtFetch(path, init) Response
}
class GitlabClient:::vcs {
 -string apiBase
 -string token
 +fetch(path, init) Response
}
class GithubVcsAppInstance:::vcs {
 -number installationId
 -string owner
 -string repo
 -GithubAppClient client
}
class GithubVcsUserInstance:::vcs
class GitlabVcsAppInstance:::vcs
class GitlabVcsUserInstance:::vcs
class GithubWebhookVerifier:::vcs
class SupabasePullRequestStore:::vcs
class SupabasePullRequestReadRepository:::vcs
class SupabaseGithubTokenRepository:::vcs
class SupabaseProviderTokenRepository:::vcs
class CommentActions:::vcs {
 <<gate>>
 +resolve(db, userId, projectId) CommentActor
}
class VcsMergeError:::vcs {
 +number status
}
class VcsReauthError:::vcs
class VcsComposition:::vcs {
 <<composition>>
 +resolveVcsAppInstance(project) VcsAppInstance
 +resolveVcsUserInstance(binding, token) VcsUserInstance
 +getWebhookVerifier() WebhookVerifier
 +getVcsAppService(project) VcsAppService
 +getVcsUserService(binding, token) VcsUserService
 +getPullRequestService(project) PullRequestService
 +importExistingIssues(projectId) ImportSummary
}

%% ANALYSIS — the bridge to bobby-analyser + the two run lifecycles
%% AnalysisModule
class ProjectAnalyser:::analysis {
 <<aggregate>>
 +EFFORTS$ EffortList
 +of(state)$ ProjectAnalyser
 +from(state)$ ProjectAnalyser
 +isValidEffort(v)$ bool
 +isReady() bool
 +isEnabled() bool
 +isIndexing() bool
 +hasFailed() bool
 +hasStarted() bool
}
class Analyser:::analysis {
 <<interface>>
 +query(repoId, question, budget) QueryResult
 +retrieve(input) RetrieveResult
 +neighbours(input) NeighboursResult
 +streamChat(repoId, q, history, ...) Response
 +analyseIssue(input) IssueAnalysis
 +startIssueAnalysis(input, taskId, cb) void
 +cancelIssueAnalysis(taskId) void
 +startPRAnalysis(input, taskId, cb) void
 +cancelPRAnalysis(taskId) void
 +deepDivePRInsight(insightId) DeepDiveResult
 +getIssuePreferences(repoId) IssuePreferences
 +setIssuePreferences(repoId, effort) IssuePreferences
 +compose(input) IssueComposeProposal
 +embed(text) EmbedResult
 +verify(input) VerifyReport
 +startIndex(input) KickoffResult
 +deleteGraph(graphId) void
}
class ProjectAnalyserRepository:::analysis {
 <<interface>>
 +findByProjectId(projectId) ProjectAnalyser
 +findReadiness(projectId) AnalyserReadinessRow
 +findGraphId(projectId) string
 +saveHealthReport(projectId, report, at) void
 +enable(projectId) ProjectAnalyser
 +disable(projectId) ProjectAnalyser
 +markIndexing(projectId, progress) void
 +markFailed(projectId, message) void
}
class PullRequestAnalysisStore:::analysis {
 <<interface>>
 +findTracking(projectId, prNumber) Tracking
 +upsertTracking(input) TrackingId
 +findResultRow(taskId) ResultRow
 +saveResult(taskId, status, result) void
}
class HttpAnalyser:::analysis {
 -base() string
 -authHeader() Headers
 -userHeader(userId) Headers
 -fail(res, message, code) never
}
class AnalyserError:::analysis {
 +string code
}
class IssueAnalysisService:::analysis {
 -Analyser analyser
 -IssueSyncStore issues
 -ProjectsRepository projects
 -ProjectAnalyserRepository analysers
 -VcsAppServiceResolver vcsFor
 -IssueAnalysisComment comment
 -IssuePrompt prompt
 +ensure(issueId, origin) EnsureOutcome
 +applyResult(taskId, status, result) void
 +cancel(issueId) void
}
class PullRequestAnalysisService:::analysis {
 -Analyser analyser
 -ProjectsRepository projects
 -ProjectAnalyserRepository analysers
 -PullRequestAnalysisStore store
 -VcsAppServiceResolver vcsFor
 -PullRequestAnalysisComment comment
 +start(project, pr, origin) void
 +applyResult(taskId, status, result) void
 +cancel(projectId, prNumber) void
}
class IssueAnalysisComment:::analysis {
 +loading(ctx) string
 +result(analysis, ctx) string
}
class PullRequestAnalysisComment:::analysis {
 +loading(origin, title, url) string
 +result(analysis, origin, url) string
}
class SupabaseProjectAnalyserRepository:::analysis
class SupabasePullRequestAnalysisStore:::analysis
class AnalysisComposition:::analysis {
 <<composition>>
 +getAnalyser() Analyser
 +createIssueAnalysisService() IssueAnalysisService
 +createPullRequestAnalysisService() PullRequestAnalysisService
}

%% NOTIFICATIONS — typed events, observer fan-out, outbox
%% NotificationsModule
class NotificationEvent:::notify {
 <<union>>
 +kb_ready
 +kb_updated
 +pr_opened
 +pr_analysis_ready
}
class NotificationPresenter:::notify {
 +render(event) RenderedNotification
 +defaultChannels(kind) ChannelIdList
}
class NotificationChannel:::notify {
 <<interface>>
 +ChannelId id
 +supports(event, recipient) bool
 +deliver(event, recipient) DeliveryResult
}
class RecipientResolver:::notify {
 <<interface>>
 +resolve(event) RecipientList
}
class OutboxStore:::notify {
 <<interface>>
 +enqueue(event) void
 +pullPending(limit) OutboxRecordList
 +markDone(id) void
}
class NotificationFeedRepository:::notify {
 <<interface>>
 +listRecent(limit) NotificationList
 +markAllRead() void
 +markRead(id) void
 +remove(id) void
}
class NotificationDispatcher:::notify {
 -Map channels
 -RecipientResolver recipients
 -NotificationPresenter presenter
 +register(channel) NotificationDispatcher
 +dispatch(event) void
}
class NotificationService:::notify {
 -NotificationDispatcher dispatcher
 -OutboxStore outbox
 +drain(limit) number
}
class InAppFeedChannel:::notify
class EmailChannel:::notify
class SupabaseRecipientResolver:::notify
class SupabaseOutboxStore:::notify
class SupabaseNotificationFeedRepository:::notify
class NotificationEmail:::notify {
 <<legacy trigger path>>
 +send(notificationId) void
}
class NotificationsComposition:::notify {
 <<composition>>
 +createNotificationService(svc) NotificationService
}

%% PUBLIC — the anonymous /p/<token> reporting surface
%% PublicModule
class PublicSession:::public {
 <<aggregate>>
 +of(state)$ PublicSession
 +isBeforeStart(now) bool
 +isAfterEnd(now) bool
 +isOpen(now) bool
 +isLinkAccess() bool
 +isInviteOnly() bool
 +showsOwnSubmissionsOnly() bool
}
class PublicReporter:::public {
 +display(id, name) string
 +groupByParent(rows) ParentRowList
 +groupParentsByReporter(parents) ReporterGroupList
}
class PublicSessionRepository:::public {
 <<interface>>
 +findByToken(token) PublicSessionRow
 +listManualProjectIds(sessionId) IdList
 +findIssueReporter(issueId) IssueReporter
 +hasInvite(sessionId, email) bool
 +findOwnership(sessionId) Ownership
}
class PublicSessionAdminRepository:::public {
 <<interface>>
 +listForTeam(teamId) PublicSessionList
 +create(input) PublicSession
 +update(id, patch) PublicSession
 +rotateToken(id, token) PublicSession
 +addProject(sessionId, projectId) SessionProjectResult
 +addInvites(sessionId, emails) InviteList
 +listEligibleProjects() ProjectNameList
}
class ProjectPublicIntegrationRepository:::public {
 <<interface>>
 +findIntegration(projectId) ProjectPublicIntegration
 +setIntegration(projectId, enabled) ProjectPublicIntegration
 +findIntegrationTab(projectId) IntegrationTab
}
class PublicSessionService:::public {
 <<gate>>
 -PublicSessionRepository sessions
 -IssuesRepository issues
 -TeamMembershipRepository teams
 -CurrentVisitor visitor
 +resolve(token) ResolvedPublicSession
 +fetchPublicIssue(session, issueId) Issue
 +requireOwnVisibility(session, issueId) Response
 +checkInviteAccess(session) InviteCheck
 +requireInviteAccess(session) Response
}
class CurrentVisitor:::public {
 +current() PublicVisitor
}
class SupabasePublicSessionRepository:::public
class SupabasePublicSessionAdminRepository:::public
class SupabaseProjectPublicIntegrationRepository:::public
class PublicComposition:::public {
 <<composition>>
 +getPublicSessionService(db) PublicSessionService
}

%% RELAY — device pairing + the analyser worker fleet
%% RelayModule
class PairingCodes:::relay {
 +deviceCode() string
 +userCode() string
 +token() string
 +normalize(code) string
}
class AnalyserWorkerDirectory:::relay {
 <<interface>>
 +listConnected() AnalyserWorkers
}
class RelayWorkerRepository:::relay {
 <<interface>>
 +listActive() RelayWorkerRowList
 +rename(id, name) void
 +revoke(id) void
}
class HttpAnalyserWorkerDirectory:::relay
class SupabaseRelayWorkerRepository:::relay
class RelayComposition:::relay {
 <<composition>>
 +getAnalyserWorkerDirectory() AnalyserWorkerDirectory
}

%% BILLING — "Prowl": tiers, points, balance (read-only over the ledger)
%% BillingModule
class Tier:::billing {
 <<value object>>
 +TIER_IDS$ TierIdList
 +of(id)$ Tier
 +all()$ TierList
 +id TierId
 +monthlyPoints number
 +isUncapped bool
 +isFree bool
}
class Balance:::billing {
 <<value object>>
 +Tier tier
 +number allowance
 +number used
 +remaining number
 +fraction number
 +isExhausted bool
 +periodEnd string
 +toJSON() BalanceDto
}
class ProwlPoints:::billing {
 <<utility>>
 +POINTS_PER_USD$ number
 +pointsFromCostUsd(costUsd) number
 +pointsFromTokens(tokens) number
 +pointsForUsage(signal) number
 +formatPoints(points) string
}
class SubscriptionsRepository:::billing {
 <<interface>>
 +findByTeam(teamId) SubscriptionRow
 +setTier(teamId, tier) SubscriptionRow
}
class UsageRepository:::billing {
 <<interface>>
 +currentPeriodUsage(teamId, periodStart) PeriodUsage
 +breakdownSince(teamId, sinceIso) UsageByKindList
 +listRecent(teamId, limit) UsageEventRowList
}
class SupabaseSubscriptionsRepository:::billing
class SupabaseUsageRepository:::billing

%% MCP — the per-project exposure flag
%% McpModule
class ProjectMcpIntegration:::mcp {
 <<value object>>
 +string project_id
 +bool enabled
}
class ProjectMcpIntegrationRepository:::mcp {
 <<interface>>
 +findIntegration(projectId) ProjectMcpIntegration
 +setIntegration(projectId, enabled) ProjectMcpIntegration
 +listEnabledProjectIds(projectIds) IdList
}
class SupabaseProjectMcpIntegrationRepository:::mcp

%% MCP SERVER — the remote Model Context Protocol surface
%% McpServerModule
class JsonRpc:::mcpsrv {
 <<protocol>>
 +rpcSuccess(id, result) JsonRpcSuccess
 +rpcFailure(id, code, msg) JsonRpcFailure
 +isJsonRpcRequest(value) bool
 +isNotification(msg) bool
}
class McpToolDefinition:::mcpsrv {
 +string name
 +string description
 +inputSchema Schema
}
class McpToolError:::mcpsrv
class McpTools:::mcpsrv {
 <<registry>>
 +TOOL_DEFINITIONS$ McpToolDefinitionList
 +executeTool(name, args, service) McpToolResult
}
class McpServer:::mcpsrv {
 -KnowledgeBaseService service
 +handle(message) JsonRpcResponse
 -initialize(params) InitializeResult
 -callTool(id, params) JsonRpcResponse
}
class KnowledgeBaseService:::mcpsrv {
 -AccessService access
 -ProjectsRepository projects
 -ProjectMcpIntegrationRepository mcpIntegration
 -ProjectAnalyserRepository projectAnalyser
 -Analyser analyser
 -string userId
 +list() KnowledgeBaseList
 +resolve(identifier) ResolvedKnowledgeBase
 +locate(ref, query, hints) RetrieveResult
 +neighbours(ref, input) NeighboursResult
}
class McpAuth:::mcpsrv {
 <<gate>>
 +MCP_SCOPE$ string
 +authenticateMcp(request) McpPrincipal
 +unauthorizedResponse(error, desc) Response
}
class McpServerComposition:::mcpsrv {
 <<composition>>
 +createKnowledgeBaseService(userId) KnowledgeBaseService
}

%% MCP OAUTH — a self-contained OAuth 2.1 Authorization Server
%% McpOAuthModule
class AuthorizationRequest:::mcpauth {
 <<value object>>
 +validate(query, client)$ ValidationOutcome
 +successUrl(code, issuer) string
 +errorUrl(error, desc, issuer) string
 +buildErrorUrl(...)$ string
}
class Pkce:::mcpauth {
 +METHOD$ string
 +isWellFormedChallenge(c)$ bool
 +isWellFormedVerifier(v)$ bool
 +challengeFor(verifier)$ string
 +verify(verifier, challenge)$ bool
}
class OpaqueSecret:::mcpauth {
 +ACCESS_PREFIX$ string
 +REFRESH_PREFIX$ string
 +CODE_PREFIX$ string
 +mint(prefix)$ string
 +mintClientId()$ string
 +hash(raw)$ string
 +equals(a, b)$ bool
}
class RedirectUris:::mcpauth {
 +isAllowed(raw)$ bool
 +validateList(value)$ ValidationOutcome
 +isRegistered(registered, candidate)$ bool
}
class ConsentCsrf:::mcpauth {
 +bindingFor(params)$ string
 +mint(secret, userId, binding)$ string
 +verify(...)$ bool
}
class OAuthError:::mcpauth {
 +number status
 +string description
 +toJson() ErrorBody
 +invalidRequest(d)$ OAuthError
 +invalidClient(d)$ OAuthError
 +invalidGrant(d)$ OAuthError
}
class OAuthClientRepository:::mcpauth {
 <<interface>>
 +find(clientId) OAuthClientRecord
 +create(client) OAuthClientRecord
}
class OAuthCodeRepository:::mcpauth {
 <<interface>>
 +create(code) void
 +find(codeHash) OAuthCodeRecord
 +consume(codeHash) bool
}
class OAuthTokenRepository:::mcpauth {
 <<interface>>
 +create(token) void
 +findByAccessHash(hash) OAuthTokenRecord
 +findByRefreshHash(hash) OAuthTokenRecord
 +revoke(id) bool
 +revokeByCodeHash(codeHash) void
 +revokeFamily(userId, clientId) void
 +listConnectionsForUser(userId) OAuthConnectionList
 +revokeForUser(id, userId) bool
 +touchLastUsed(id) void
}
class OAuthClientService:::mcpauth {
 -OAuthClientRepository clients
 +register(body) RegisteredClient
}
class OAuthAuthorizationService:::mcpauth {
 -OAuthClientRepository clients
 -OAuthCodeRepository codes
 +describe(query) DescribeResult
 +issueCode(request, userId) CodeOutcome
}
class OAuthTokenService:::mcpauth {
 -OAuthClientRepository clients
 -OAuthCodeRepository codes
 -OAuthTokenRepository tokens
 +exchangeCode(req) IssuedTokens
 +refresh(req) IssuedTokens
 +revoke(rawToken, clientId) void
 +resolveAccessToken(rawToken) McpTokenClaims
}
class OAuthServerConfig:::mcpauth {
 +issuer() string
 +canonicalResource() string
 +metadata() DiscoveryDocument
}
class ConsentServerSecret:::mcpauth
class OAuthHttp:::mcpauth {
 <<utility>>
 +corsPreflight() Response
 +credentialJson(body) Response
 +discoveryJson(body) Response
 +oauthErrorJson(err) Response
}
class SupabaseOAuthClientRepository:::mcpauth
class SupabaseOAuthCodeRepository:::mcpauth
class SupabaseOAuthTokenRepository:::mcpauth
class McpOAuthComposition:::mcpauth {
 <<composition>>
 +getOAuthClientService() OAuthClientService
 +getOAuthAuthorizationService() OAuthAuthorizationService
 +getOAuthTokenService() OAuthTokenService
 +resolveAccessToken(raw) McpTokenClaims
}

%% CLIENT RUNTIME — lib/client (browser)
%% ClientRuntime
class AuthProvider:::client {
 <<react context>>
 +user User
 +session Session
 +loading bool
}
class TeamProvider:::client {
 <<react context>>
 +teams TeamWithRoleList
 +activeTeam TeamWithRole
 +setActiveTeam(id) void
}
class useApi:::client {
 <<hook>>
 +useApi(path, opts) ApiState
}
class ApiClient:::client {
 <<utility>>
 +apiMutate(path, opts) T
}
class ApiError:::client {
 +string code
 +number status
}

%% EXTERNAL SYSTEMS
%% ExternalSystems
class BobbyAnalyser:::external {
 <<external>>
 +POST /query /retrieve /neighbours
 +POST /issues/analyse /issues/compose
 +POST /pr/analyse
 +POST /embeddings /verify /jobs/run
 +writes prowl_usage_events
}
class GitHubApi:::external {
 <<external>>
 +REST + GraphQL
 +App installation tokens
 +webhooks
}
class GitLabApi:::external {
 <<external>>
 +REST v4
 +project webhooks
}
class SupabasePostgres:::external {
 <<external>>
 +schema tracker
 +RLS + triggers + pg_net
 +pgvector embeddings
}
class StalwartJmap:::external {
 <<external>>
 +JMAP over HTTPS
}
class CloudflareWorkers:::external {
 <<external>>
 +rate-limit bindings
 +after() keep-alive
}
class ClaudeMcpClient:::external {
 <<external>>
 +OAuth 2.1 + JSON-RPC
}

%% KERNEL realizations
SystemClock ..|> Clock
WorkersBackgroundTasks ..|> BackgroundTasks
CryptoIdGenerator ..|> IdGenerator
InProcessEventBus ..|> EventBus
InProcessEventBus ..> DomainEvent
WorkersBackgroundTasks ..> CloudflareWorkers : after()
OAuthError --|> DomainError

%% SERVER PLATFORM wiring
ApiContext o-- SessionGateway
ApiContext ..> RequestContext : hands to routes
ApiContext ..> Role : atLeast()
ApiContext ..> HttpResponses
SupabaseSessionGateway ..|> SessionGateway
SupabaseSessionGateway ..> Supabase
SupabaseSessionGateway ..> RequestContext : opens
Supabase *-- AuthJwt
Supabase ..> SupabasePostgres
RequestContext --> SupabasePostgres : RLS-scoped client
HttpResponses ..> RepositoryError
RateLimiter ..> CloudflareWorkers
EmailTransport ..> StalwartJmap

%% RequestContext — the request-scoped repository catalogue
RequestContext ..> AccessService
RequestContext ..> ProjectsRepository
RequestContext ..> IssuesRepository
RequestContext ..> IssueCommentsReadRepository
RequestContext ..> ProjectDisplayRepository
RequestContext ..> ProjectAnalyserRepository
RequestContext ..> GithubTokenRepository
RequestContext ..> ProviderTokenRepository
RequestContext ..> PullRequestReadRepository
RequestContext ..> TeamMembershipRepository
RequestContext ..> TeamsRepository
RequestContext ..> TeamInvitesRepository
RequestContext ..> AccessGroupsRepository
RequestContext ..> CollectionsRepository
RequestContext ..> PublicSessionRepository
RequestContext ..> PublicSessionAdminRepository
RequestContext ..> ProjectPublicIntegrationRepository
RequestContext ..> ProjectMcpIntegrationRepository
RequestContext ..> RelayWorkerRepository
RequestContext ..> NotificationFeedRepository
RequestContext ..> SubscriptionsRepository
RequestContext ..> UsageRepository

%% ACCESS
AccessService o-- ProjectsRepository
AccessService o-- TeamMembershipRepository
AccessService *-- AccessPolicy
AccessPolicy ..> Role
AccessComposition ..> AccessService : creates
AccessComposition ..> SupabaseProjectsRepository
AccessComposition ..> SupabaseTeamMembershipRepository

%% TEAMS
SupabaseTeamsRepository ..|> TeamsRepository
SupabaseTeamMembershipRepository ..|> TeamMembershipRepository
SupabaseTeamInvitesRepository ..|> TeamInvitesRepository
SupabaseAccessGroupsRepository ..|> AccessGroupsRepository
SupabaseCollectionsRepository ..|> CollectionsRepository
SupabaseAdminUserDirectory ..|> UserDirectory
JmapInviteNotifier ..|> InviteNotifier
TeamMemberViews o-- UserDirectory
JmapInviteNotifier ..> EmailTransport
SupabaseAdminUserDirectory ..> Supabase : service role
TeamsComposition ..> JmapInviteNotifier
TeamsComposition ..> TeamMemberViews
SupabaseTeamsRepository ..> SupabasePostgres
SupabaseTeamMembershipRepository ..> SupabasePostgres
SupabaseCollectionsRepository ..> SupabasePostgres

%% PROJECTS
SupabaseProjectsRepository ..|> ProjectsRepository
SupabaseProjectDisplayRepository ..|> ProjectDisplayRepository
SupabaseProjectsRepository ..> SupabasePostgres
SupabaseProjectsRepository ..> DbRowTypes
ProjectInsight ..> DbRowTypes : drift-guarded

%% ISSUES
SupabaseIssuesRepository ..|> IssuesRepository
SupabaseEmbeddingIndex ..|> EmbeddingIndex
SupabaseIssueCommentsReadRepository ..|> IssueCommentsReadRepository
ServiceIssueSyncStore ..|> IssueSyncStore
IssueEmbedder o-- Analyser
IssueEmbedder o-- EmbeddingIndex
IssueEmbedder *-- EmbeddingText
EmbeddingText ..> Analyser : IssueComposeProposal
IssuesComposition ..> IssueEmbedder
IssuesComposition ..> ServiceIssueSyncStore
IssuesComposition ..> SupabaseEmbeddingIndex
IssuesComposition ..> AnalysisComposition : getAnalyser()
SupabaseEmbeddingIndex ..> SupabasePostgres : partitioned by project_id
ServiceIssueSyncStore ..> Supabase : service role
Issue ..> DbRowTypes : drift-guarded

%% VCS — realizations
GithubVcsAppInstance ..|> VcsAppInstance
GitlabVcsAppInstance ..|> VcsAppInstance
GithubVcsUserInstance ..|> VcsUserInstance
GitlabVcsUserInstance ..|> VcsUserInstance
GithubWebhookVerifier ..|> WebhookVerifier
SupabasePullRequestStore ..|> PullRequestStore
SupabasePullRequestReadRepository ..|> PullRequestReadRepository
SupabaseGithubTokenRepository ..|> GithubTokenRepository
SupabaseProviderTokenRepository ..|> ProviderTokenRepository

%% VCS — services over ports
VcsAppService o-- VcsAppInstance
VcsAppService o-- IssueSyncStore
VcsAppService *-- SyncHash
VcsAppService ..> Issue : githubState()
VcsAppService ..> Project : isSyncReady()
VcsUserService o-- VcsUserInstance
PullRequestService o-- VcsAppInstance
PullRequestService o-- PullRequestStore
PullRequestService ..> IssueSyncStore : comment sink
MergePolicy ..> FindingState
PullRequest ..> DbRowTypes : drift-guarded

%% VCS — adapters to vendors
GithubVcsAppInstance o-- GithubAppClient
GithubAppClient ..> GitHubApi
GithubAppClient ..> Supabase : installation tokens
GithubVcsUserInstance ..> GitHubApi
GithubWebhookVerifier ..> GitHubApi : HMAC-SHA256
GitlabVcsAppInstance ..> GitlabClient
GitlabVcsUserInstance ..> GitlabClient
GitlabClient ..> GitLabApi
SupabasePullRequestStore ..> Supabase : service role
SupabasePullRequestReadRepository ..> SupabasePostgres

%% VCS — the composition seam (the ONE place providers branch)
VcsComposition ..> GithubVcsAppInstance : new
VcsComposition ..> GitlabVcsAppInstance : new
VcsComposition ..> GithubVcsUserInstance : new
VcsComposition ..> GitlabVcsUserInstance : new
VcsComposition ..> GithubWebhookVerifier
VcsComposition ..> VcsAppService
VcsComposition ..> VcsUserService
VcsComposition ..> PullRequestService
VcsComposition ..> RepoRef : ownerRepo()
VcsComposition ..> IssuesComposition : IssueSyncStore
VcsComposition ..> SupabaseProjectsRepository
VcsComposition ..> Project

%% VCS — the comment-authoring gate
CommentActions ..> GithubTokenRepository
CommentActions ..> ProviderTokenRepository
CommentActions ..> VcsComposition : getVcsUserService()
CommentActions ..> ProjectsRepository
CommentActions ..> RepoRef
CommentActions ..> VcsReauthError

%% ANALYSIS
HttpAnalyser ..|> Analyser
HttpAnalyser ..> BobbyAnalyser
HttpAnalyser ..> AnalyserError
SupabaseProjectAnalyserRepository ..|> ProjectAnalyserRepository
SupabasePullRequestAnalysisStore ..|> PullRequestAnalysisStore
SupabasePullRequestAnalysisStore ..> Supabase : service role

IssueAnalysisService o-- Analyser
IssueAnalysisService o-- IssueSyncStore
IssueAnalysisService o-- ProjectsRepository
IssueAnalysisService o-- ProjectAnalyserRepository
IssueAnalysisService o-- IssueAnalysisComment
IssueAnalysisService o-- IssuePrompt
IssueAnalysisService ..> VcsAppService : postComment / updateComment
IssueAnalysisService ..> ProjectAnalyser : isReady()
IssueAnalysisService ..> Project : isSyncReady()

PullRequestAnalysisService o-- Analyser
PullRequestAnalysisService o-- ProjectsRepository
PullRequestAnalysisService o-- ProjectAnalyserRepository
PullRequestAnalysisService o-- PullRequestAnalysisStore
PullRequestAnalysisService o-- PullRequestAnalysisComment
PullRequestAnalysisService ..> VcsAppService : PR diff + comments
PullRequestAnalysisService ..> ProjectAnalyser
PullRequestAnalysisService ..> Project

AnalysisComposition ..> HttpAnalyser : new
AnalysisComposition ..> IssueAnalysisService
AnalysisComposition ..> PullRequestAnalysisService
AnalysisComposition ..> VcsComposition : getVcsAppService
AnalysisComposition ..> IssuesComposition
AnalysisComposition ..> SupabaseProjectsRepository
ProjectAnalyser ..> DbRowTypes : drift-guarded

%% NOTIFICATIONS
InAppFeedChannel ..|> NotificationChannel
EmailChannel ..|> NotificationChannel
SupabaseRecipientResolver ..|> RecipientResolver
SupabaseOutboxStore ..|> OutboxStore
SupabaseNotificationFeedRepository ..|> NotificationFeedRepository
NotificationDispatcher o-- RecipientResolver
NotificationDispatcher o-- NotificationChannel : registered 0..*
NotificationDispatcher *-- NotificationPresenter
NotificationService o-- NotificationDispatcher
NotificationService o-- OutboxStore
NotificationPresenter ..> NotificationEvent
InAppFeedChannel *-- NotificationPresenter
EmailChannel *-- NotificationPresenter
EmailChannel ..> EmailTransport
SupabaseRecipientResolver ..> ProjectsRepository : findTeamId
SupabaseRecipientResolver ..> TeamMembershipRepository : fan-out
SupabaseOutboxStore ..> SupabasePostgres : notification_outbox
NotificationEmail ..> EmailTransport
NotificationEmail ..> PullRequestStore
NotificationEmail ..> ProjectsRepository
NotificationEmail ..> Badge
NotificationsComposition ..> NotificationService
NotificationsComposition ..> NotificationDispatcher
NotificationsComposition ..> InAppFeedChannel
NotificationsComposition ..> EmailChannel
NotificationsComposition ..> SupabaseRecipientResolver
NotificationsComposition ..> SupabaseOutboxStore

%% PUBLIC
SupabasePublicSessionRepository ..|> PublicSessionRepository
SupabasePublicSessionAdminRepository ..|> PublicSessionAdminRepository
SupabaseProjectPublicIntegrationRepository ..|> ProjectPublicIntegrationRepository
PublicSessionService o-- PublicSessionRepository
PublicSessionService o-- IssuesRepository
PublicSessionService o-- TeamMembershipRepository
PublicSessionService *-- CurrentVisitor
PublicSessionService ..> PublicSession : window + access rules
PublicSessionService ..> HttpResponses
CurrentVisitor ..> Supabase
PublicComposition ..> PublicSessionService
PublicComposition ..> SupabasePublicSessionRepository
PublicComposition ..> SupabaseIssuesRepository
PublicComposition ..> SupabaseTeamMembershipRepository
PublicReporter ..> DbRowTypes : drift-guarded

%% RELAY
HttpAnalyserWorkerDirectory ..|> AnalyserWorkerDirectory
HttpAnalyserWorkerDirectory ..> BobbyAnalyser
SupabaseRelayWorkerRepository ..|> RelayWorkerRepository
RelayComposition ..> HttpAnalyserWorkerDirectory

%% BILLING
SupabaseSubscriptionsRepository ..|> SubscriptionsRepository
SupabaseUsageRepository ..|> UsageRepository
Balance *-- Tier
Balance ..> ProwlPoints
SupabaseUsageRepository ..> SupabasePostgres : prowl_usage_events
BobbyAnalyser ..> SupabasePostgres : records usage (service role)

%% MCP + MCP SERVER
SupabaseProjectMcpIntegrationRepository ..|> ProjectMcpIntegrationRepository
SupabaseProjectMcpIntegrationRepository ..> ProjectMcpIntegration
McpServer o-- KnowledgeBaseService
McpServer ..> JsonRpc
McpServer ..> McpTools
McpServer ..> McpToolError
McpTools ..> McpToolDefinition
McpTools ..> KnowledgeBaseService
KnowledgeBaseService o-- AccessService
KnowledgeBaseService o-- ProjectsRepository
KnowledgeBaseService o-- ProjectMcpIntegrationRepository
KnowledgeBaseService o-- ProjectAnalyserRepository
KnowledgeBaseService o-- Analyser
KnowledgeBaseService ..> McpToolError
McpAuth ..> McpOAuthComposition : resolveAccessToken
McpServerComposition ..> KnowledgeBaseService
McpServerComposition ..> AccessComposition
McpServerComposition ..> AnalysisComposition
McpServerComposition ..> Supabase : service role

%% MCP OAUTH
SupabaseOAuthClientRepository ..|> OAuthClientRepository
SupabaseOAuthCodeRepository ..|> OAuthCodeRepository
SupabaseOAuthTokenRepository ..|> OAuthTokenRepository
OAuthClientService o-- OAuthClientRepository
OAuthAuthorizationService o-- OAuthClientRepository
OAuthAuthorizationService o-- OAuthCodeRepository
OAuthTokenService o-- OAuthClientRepository
OAuthTokenService o-- OAuthCodeRepository
OAuthTokenService o-- OAuthTokenRepository
OAuthAuthorizationService ..> AuthorizationRequest
OAuthAuthorizationService ..> OpaqueSecret
OAuthClientService ..> RedirectUris
OAuthClientService ..> OpaqueSecret
OAuthTokenService ..> Pkce
OAuthTokenService ..> OpaqueSecret
OAuthTokenService ..> OAuthError
AuthorizationRequest ..> Pkce
AuthorizationRequest ..> RedirectUris
ConsentCsrf ..> OpaqueSecret
ConsentCsrf ..> ConsentServerSecret
Pkce ..> OpaqueSecret
McpOAuthComposition ..> OAuthClientService
McpOAuthComposition ..> OAuthAuthorizationService
McpOAuthComposition ..> OAuthTokenService
McpOAuthComposition ..> Supabase : service role

%% INTERFACE LAYER → modules
IssuesApi ..> ApiContext
IssuesApi ..> IssuesRepository
IssuesApi ..> VcsComposition : getVcsAppService
IssuesApi ..> IssuesComposition : createIssueEmbedder
IssuesApi ..> AnalysisComposition : createIssueAnalysisService
IssuesApi ..> ProjectAnalyser

ProjectsApi ..> ApiContext
ProjectsApi ..> ProjectsRepository
ProjectsApi ..> ProjectAnalyserRepository
ProjectsApi ..> Analyser
ProjectsApi ..> ProjectDisplayRepository

PullsApi ..> ApiContext
PullsApi ..> PullRequestReadRepository
PullsApi ..> MergePolicy
PullsApi ..> VcsComposition
PullsApi ..> PullRequestStore
PullsApi ..> VcsMergeError
PullsApi ..> PullRequestAnalysisService

CommentsApi ..> ApiContext
CommentsApi ..> CommentActions
CommentsApi ..> VcsUserService
CommentsApi ..> IssueSyncStore
CommentsApi ..> IssueCommentsReadRepository

GithubWebhookRoute ..> WebhookVerifier
GithubWebhookRoute ..> SyncHash
GithubWebhookRoute ..> Issue
GithubWebhookRoute ..> Project
GithubWebhookRoute ..> IssueSyncStore
GithubWebhookRoute ..> PullRequestStore
GithubWebhookRoute ..> IssueAnalysisService
GithubWebhookRoute ..> PullRequestAnalysisService
GithubWebhookRoute ..> IssueEmbedder
GithubWebhookRoute ..> BackgroundTasks : after()
GitHubApi ..> GithubWebhookRoute : delivers events

GitlabWebhookRoute ..> SyncHash
GitlabWebhookRoute ..> IssueAnalysisService
GitlabWebhookRoute ..> PullRequestAnalysisService
GitlabWebhookRoute ..> IssueEmbedder
GitlabWebhookRoute ..> PullRequestStore
GitLabApi ..> GitlabWebhookRoute : delivers events

AnalysisCallbackApi ..> IssueAnalysisService
AnalysisCallbackApi ..> PullRequestAnalysisService
BobbyAnalyser ..> AnalysisCallbackApi : run callback

NotificationsApi ..> ApiContext
NotificationsApi ..> NotificationFeedRepository
NotificationsApi ..> NotificationService
NotificationsApi ..> NotificationEmail
SupabasePostgres ..> NotificationsApi : pg_net trigger

TeamsApi ..> ApiContext
TeamsApi ..> Role
TeamsApi ..> TeamsRepository
TeamsApi ..> TeamMembershipRepository
TeamsApi ..> TeamInvitesRepository
TeamsApi ..> AccessGroupsRepository
TeamsApi ..> TeamMemberViews
TeamsApi ..> TeamsComposition
TeamsApi ..> Invite
TeamsApi ..> Email

GroupsApi ..> ApiContext
GroupsApi ..> CollectionsRepository
GroupsApi ..> ProjectsRepository
GroupsApi ..> Analyser
GroupsApi ..> EmbeddingText
GroupsApi ..> ProjectAnalyser

SessionsApi ..> ApiContext
SessionsApi ..> PublicSessionAdminRepository
SessionsApi ..> ProjectPublicIntegrationRepository

PublicApi ..> PublicComposition
PublicApi ..> PublicSessionService
PublicApi ..> CurrentVisitor
PublicApi ..> RateLimiter
PublicApi ..> IssueEmbedder
PublicApi ..> PublicSession

RelayApi ..> PairingCodes
RelayApi ..> RateLimiter
RelayApi ..> RelayWorkerRepository
RelayApi ..> AnalyserWorkerDirectory

BillingApi ..> ApiContext
BillingApi ..> Balance
BillingApi ..> SubscriptionsRepository
BillingApi ..> UsageRepository

McpApi ..> McpAuth
McpApi ..> McpServer
McpApi ..> McpServerComposition
McpApi ..> JsonRpc
ClaudeMcpClient ..> McpApi : JSON-RPC over HTTP

OAuthApi ..> McpOAuthComposition
OAuthApi ..> OAuthServerConfig
OAuthApi ..> OAuthHttp
OAuthApi ..> ConsentCsrf
OAuthApi ..> RateLimiter
OAuthApi ..> OAuthTokenRepository
ClaudeMcpClient ..> OAuthApi : OAuth 2.1 + PKCE

%% CLIENT RUNTIME
TeamProvider ..> AuthProvider
TeamProvider ..> useApi
useApi ..> IssuesApi : GET
ApiClient ..> IssuesApi : POST PATCH DELETE
ApiClient ..> ApiError
TeamProvider ..> ApiContext : x-team-id header

note for RequestContext "The per-request UNIT OF WORK — every route reaches a store only through these ports. Zero raw .from() in app/api."
note for VcsComposition "The provider swap point. A caller holds VcsAppInstance; this is the ONLY file that knows it is GitHub or GitLab."
note for NotificationDispatcher "BUILT, NOT CUT OVER: the live path is still the DB trigger (0049/0051). Cutover waits on the outbox migration."
note for AccessService "The app-layer half of the HYBRID authz model — coarse RLS proves team membership, this adds the group-level project gate."
```

---

## Subsystem index

| Namespace | Directory | Role | Owns / speaks to |
| --- | --- | --- | --- |
| `SharedKernel` | `lib/shared/kernel/` | `Result`/`DomainError`, the event bus seam, `Clock`/`BackgroundTasks`/`IdGenerator` ports + their Workers adapters | nothing — pure |
| `SharedRuntime` | `lib/shared/` | Runtime-agnostic helpers both sides import: generated DB row types, `findingState`, badges, icons, realtime channel names | — |
| `ServerPlatform` | `lib/server/` | The request seam: `ApiContext` guards → `SessionGateway` → `RequestContext` unit of work; `Supabase` client factories, `AuthJwt`, `RateLimiter`, `EmailTransport` | Supabase, Cloudflare bindings, Stalwart JMAP |
| `InterfaceLayer` | `app/api/**` | ~120 thin route handlers: parse → validate → authorize → delegate | every module contract |
| `AccessModule` | `modules/access/` | The app-layer half of the hybrid authz model: role ordering, group-scoped project visibility | no tables — a policy over Teams + Projects |
| `TeamsModule` | `modules/teams/` | Teams, memberships, people-groups (`access_groups`), Collections (`project_groups`), invites, identity resolution | `teams`, `team_members`, `team_invites`, `access_groups*`, `project_groups*` |
| `ProjectsModule` | `modules/projects/` | The `Project` aggregate (sync invariants) + `ProjectInsight` tile read-model | `projects`, `project_insights`, `project_label_icons`, `project_status_colors` |
| `IssuesModule` | `modules/issues/` | The `Issue` aggregate, issue CRUD, the GitHub-sync bookkeeping store, the embedding index | `issues`, `issue_comments`, `issue_suggestions`, `issue_embeddings` |
| `VcsModule` | `modules/vcs/` | **The reference module.** Provider-agnostic git hosting split by authority (app/bot vs signed-in user) + the PR mirror | `pull_requests`, `pr_comments`, `github_tokens`, `provider_tokens` · GitHub + GitLab |
| `AnalysisModule` | `modules/analysis/` | The `Analyser` port to bobby-analyser + the two durable, cancellable run lifecycles (issue auto-analysis, PR review) | `project_analyser`, `pull_request_analyses` · bobby-analyser |
| `NotificationsModule` | `modules/notifications/` | Typed event catalogue → dispatcher → channels, with an outbox for at-least-once delivery | `notifications`, `notification_outbox` |
| `PublicModule` | `modules/public/` | The anonymous `/p/<token>` reporting surface: session windows, link-vs-invite access, own-vs-all visibility | `public_sessions*`, `project_public_integration` |
| `RelayModule` | `modules/relay/` | Device-pairing codes + the analyser worker fleet directory | `relay_workers` |
| `BillingModule` | `modules/billing/` | "Prowl": the tier ladder, Prowl Points, per-period balance. Read-only — the analyser writes the ledger | `team_subscriptions`, `prowl_usage_events` |
| `McpModule` | `modules/mcp/` | The per-project MCP exposure flag | `project_mcp_integration` |
| `McpServerModule` | `modules/mcp-server/` | The remote MCP surface: JSON-RPC dispatch + the knowledge-base tools, gated by access **and** exposure | — · Claude clients |
| `McpOAuthModule` | `modules/mcp-oauth/` | A self-contained OAuth 2.1 AS: DCR, PKCE, opaque tokens, rotation + replay detection | `mcp_oauth_clients/codes/tokens` |
| `ClientRuntime` | `lib/client/` | Browser auth + active-team context, the read hook and the single mutation path | the API routes |

## Five things the diagram makes visible

1. **`RequestContext` is the hub of the interface layer.** Twenty-two repository
   ports hang off it, and every route reaches persistence through one of them —
   which is why there is no raw `.from()` anywhere in `app/api/**`.
2. **Every vendor is behind exactly one realization edge.** GitHub, GitLab,
   bobby-analyser, JMAP and the Cloudflare bindings each terminate at a single
   adapter class; nothing upstream of that adapter names them.
3. **The two analysis services are the only cross-context orchestrators.**
   `IssueAnalysisService` and `PullRequestAnalysisService` each hold six injected
   collaborators spanning four modules — and still touch no token, no owner/repo
   and no DB client, because all six arrive as ports.
4. **Composition seams are the only place `new` meets a concrete class.** Follow
   any `<<composition>>` node and every outgoing edge is a construction edge; every
   edge into it from a caller asks for a port.
5. **Notifications are drawn twice on purpose.** The dispatcher/outbox pipeline is
   fully wired but not yet cut over; `NotificationEmail` is the legacy DB-trigger
   path still serving `/api/internal/notification-email` until the outbox lands.
