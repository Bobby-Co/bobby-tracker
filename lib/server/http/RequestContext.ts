// RequestContext — the per-request UNIT OF WORK. It holds the caller's RLS-scoped
// DB handles and hands out module repositories already bound to them, so a route
// handler depends on the module CONTRACTS (IssuesRepository, AccessService, …)
// and never touches a DB client itself.
//
// This is the one interface-layer place that knows the concrete Supabase-backed
// factories — composition/wiring. Routes and ApiContext see only the abstractions
// it returns; swapping the store means changing the factories referenced here,
// nothing at a call site.
//
// ─── Two handles, one database (for now) ─────────────────────────────────────
//
// Every repository is bound to either the CONTROL plane or the DATA plane:
//
//   control — identity, teams, membership, billing, user tokens, every table the
//             browser subscribes to over realtime, AND `projects` with its
//             per-project config. Small, read-mostly, and — crucially — the only
//             place anything is enumerated across a whole team.
//   data    — the per-issue and per-PR content: issues, their comments, the PR
//             mirror (and, below the repository layer, issue_embeddings). Large,
//             always addressed by id or project_id, never listed team-wide.
//             Server-accessed only: no browser holds a connection to it.
//
// `projects` sits on the CONTROL side for two concrete reasons, both learned the
// hard way. Four queries enumerate a team's worth of projects — the sidebar/grid,
// the create-time duplicate check, the collections picker, and MCP's
// list_knowledge_bases — and a regional `projects` makes each return a silent
// subset. And inbound webhooks resolve a project by external repo id with no team
// context at all, so it has to be centrally findable.
//
// TODAY BOTH HANDLES ARE THE SAME CLIENT and this split is behaviourally a no-op.
// It exists because introducing the seam later means touching every route-facing
// repository at once, whereas doing it here is one file.
//
// The classification is the useful part even while it's inert: it says out loud
// which side of the line every table sits on. Note that nothing straddles any
// more — with `projects` central, AccessService reads only control-plane tables,
// so authorization never needs to reach a regional database to decide anything.
//
// Authorization for the data plane is AccessService, NOT row-level security.
// That is deliberate and already proven: AccessService was built RLS-independent
// so MCP could reuse it under a service-role client, and it makes every decision
// from the control plane's own tables — so a revoked membership takes effect
// immediately, with no replicated copy to go stale. The alternative (mirroring
// the teaming tables into each region so RLS keeps resolving there) buys a
// per-row backstop at the cost of replication to operate, a shared JWT signing
// key across regions, and a staleness window that is open continuously rather
// than only when there is a bug.

import type { SupabaseRlsClient } from "@/lib/server/supabase"
import { getAccessService } from "@/modules/access"
import {
    createSupabaseProjectsRepository,
    createSupabaseProjectDisplayRepository,
    createSupabaseProjectContentPurge,
    ProjectDeletionService,
} from "@/modules/projects"
import {
    createSupabaseIssuesRepository,
    createSupabaseIssueCommentsReadRepository,
    createSupabaseIssueSuggestionsRepository,
} from "@/modules/issues"
import { createSupabaseProjectAnalyserRepository } from "@/modules/analysis"
import {
    createGithubTokenRepository,
    createProviderTokenRepository,
    createSupabasePullRequestReadRepository,
} from "@/modules/vcs"
import {
    createSupabaseTeamMembershipRepository,
    createSupabaseTeamsRepository,
    createSupabaseTeamInvitesRepository,
    createSupabaseAccessGroupsRepository,
    createSupabaseCollectionsRepository,
} from "@/modules/teams"
import {
    createSupabasePublicSessionRepository,
    createSupabasePublicSessionAdminRepository,
    createSupabaseProjectPublicIntegrationRepository,
} from "@/modules/public"
import { createSupabaseReviewProfileRepository } from "@/modules/analysis"
import { createSupabaseProjectMcpIntegrationRepository } from "@/modules/mcp"
import { createSupabaseRelayWorkerRepository } from "@/modules/relay"
import { createSupabaseNotificationFeedRepository } from "@/modules/notifications"
import {
    createSupabaseSubscriptionsRepository,
    createSupabaseUsageRepository,
    createSupabaseUsageSubjectStore,
    PeriodUsageReader,
    SpendGate,
} from "@/modules/billing"
import { getRegionRegistry, type CellId } from "@/modules/regions"
import { Supabase } from "@/lib/server/supabase"
import { dbRef, trace } from "@/lib/server/trace"

export class RequestContext {
    /** The data plane's client, or null until a region is bound.
     *
     *  Null is the DEFAULT, and that is the whole point. The alternative —
     *  defaulting to the control database — is a fallback that cannot fail
     *  loudly: a route that forgets to bind would read the wrong region, succeed,
     *  and return an empty result indistinguishable from "this team has no issues
     *  yet". Wrong data returned confidently is worse than a 500, so an unbound
     *  data-plane access throws. */
    private dataClient: SupabaseRlsClient | null

    /** Pass `dataDb` to pre-bind (single-database hosts and tests construct this
     *  exactly as before). Omit it and the caller MUST bind a region before
     *  touching the data plane. */
    constructor(
        private readonly controlDb: SupabaseRlsClient,
        dataDb?: SupabaseRlsClient,
    ) {
        this.dataClient = dataDb ?? null
    }

    /** Which cell this context's data plane is bound to, if any. Exposed for
     *  diagnostics and for the guards to avoid re-resolving. */
    private boundCell: CellId | null = null
    get cell(): CellId | null {
        return this.boundCell
    }

    /** Point the data plane at a TEAM's region. Idempotent per cell, so guards
     *  that bind more than once on a request pay a single resolve.
     *
     *  A cell with no database of its own binds to the CONTROL client rather than
     *  throwing: that is every cell's state before its rows are moved, and it is
     *  the honest answer — the team's data really is central. Only an explicitly
     *  configured cell diverts reads, so switching a region on is one env pair,
     *  and switching it off again is removing that pair. */
    async bindTeam(teamId: string): Promise<void> {
        const cell = await this.teams.findCell(teamId)
        trace("ctx.bindTeam", { teamId, cell })
        if (!cell) {
            // No placement recorded (pre-0064 rows, or a malformed column). The
            // team's data is central by definition — it was never moved.
            this.bindCentral()
            return
        }
        this.bindCell(cell)
    }

    /** Bind directly when the cell is already known (project routes resolve it
     *  from the project, avoiding a second lookup). */
    bindCell(cell: CellId): void {
        if (this.boundCell === cell && this.dataClient) return
        const registry = getRegionRegistry()
        const config = registry.cell(cell)
        const regional = registry.hasDatabase(cell)
        trace("ctx.bindCell", { cell, regional, db: regional ? dbRef(config.supabaseUrl) : "control" })
        this.boundCell = cell
        this.dataClient = regional
            ? (Supabase.forRegion(config.supabaseUrl, config.supabaseServiceKey, cell) as SupabaseRlsClient)
            : this.controlDb
    }

    /** Bind the data plane to the control database — the correct binding for a
     *  team whose rows have not moved. */
    bindCentral(): void {
        trace("ctx.bindCentral", {})
        this.boundCell = getRegionRegistry().homeCell()
        this.dataClient = this.controlDb
    }

    /** The bound data-plane client, for handing to a service that this context
     *  does not construct (the analysis services, which are composed elsewhere).
     *  Throws when unbound, exactly like the private accessor — a route that
     *  reaches for this before its guard has bound a region has the same bug. */
    get dataPlaneClient(): SupabaseRlsClient {
        return this.dataDb
    }

    private get dataDb(): SupabaseRlsClient {
        if (!this.dataClient) {
            throw new Error(
                "data plane accessed before a region was bound — the route's guard must call bindTeam/bindCell first",
            )
        }
        return this.dataClient
    }

    /** App-layer authorization: roles, project visibility, active-team resolution.
     *
     *  Entirely control-plane. `canAccessProject` reads `projects.team_id` and
     *  then `team_members`, both central — so an authorization decision never
     *  waits on a regional round trip, and never depends on a regional database
     *  being reachable. This is what lets the data plane be service-role: the
     *  gate has already closed before anything regional is touched. */
    get access() {
        return getAccessService(this.controlDb)
    }

    // ─── data plane: per-issue / per-PR content ──────────────────────────────
    // Every query against these is keyed by id or project_id — verified across
    // the codebase — so none of them span a team and none break when they move.
    get issues() {
        return createSupabaseIssuesRepository(this.dataDb)
    }
    get issueComments() {
        return createSupabaseIssueCommentsReadRepository(this.dataDb)
    }
    get pullRequests() {
        return createSupabasePullRequestReadRepository(this.dataDb)
    }
    /** Clears a project's REGIONAL content. Data plane by definition — it exists
     *  precisely because those tables are the ones the database stopped cascading
     *  into when the planes split. */
    get projectContentPurge() {
        return createSupabaseProjectContentPurge(this.dataDb)
    }

    // ─── control plane: realtime tables ──────────────────────────────────────
    // The `supabase_realtime` publication carries exactly three tables:
    // project_analyser, issue_suggestions and notifications. The browser
    // subscribes to all three with postgres_changes, and a browser can only
    // subscribe to a database whose JWTs it holds — so keeping every realtime
    // table on the control plane means the client keeps ONE Supabase connection,
    // one CSP connect-src, one set of credentials, while the regional data plane
    // stays server-accessed only. That is what removes the need to share a JWT
    // signing key across regions at all.
    //
    // Both are already shaped for it: 0052 gave them a denormalised `team_id`
    // precisely so their policies are single-column checks with no join to the
    // content side. Their project/issue references become soft under a split,
    // which is the same trade every cross-plane FK makes.

    /** Per-project analyser state: enabled, status, graph_id, indexing progress.
     *  Realtime — the indexing panel watches it live. */
    get analyser() {
        return createSupabaseProjectAnalyserRepository(this.controlDb)
    }
    /** Cached analyser output per issue. Realtime — the suggestion box shows a
     *  result the moment the detached run's callback writes it. */
    get issueSuggestions() {
        return createSupabaseIssueSuggestionsRepository(this.controlDb)
    }

    /** A team's saved PR-reviewer profiles (0077). Control plane, alongside teams
     *  and billing: a profile belongs to a team, and a team cannot span regions,
     *  so its reviewer configuration has exactly one home. */
    get reviewProfiles() {
        return createSupabaseReviewProfileRepository(this.controlDb)
    }

    get projects() {
        return createSupabaseProjectsRepository(this.controlDb)
    }

    get projectDisplay() {
        return createSupabaseProjectDisplayRepository(this.controlDb)
    }

    get publicSessions() {
        return createSupabasePublicSessionRepository(this.controlDb)
    }

    get sessionsAdmin() {
        return createSupabasePublicSessionAdminRepository(this.controlDb)
    }

    get publicIntegration() {
        return createSupabaseProjectPublicIntegrationRepository(this.controlDb)
    }

    /** Per-project MCP exposure flag (project_mcp_integration) — whether this
     *  project's knowledge base may be served to an MCP client. */
    get mcpIntegration() {
        return createSupabaseProjectMcpIntegrationRepository(this.controlDb)
    }

    /** Collections (project_groups) — groupings OF projects. Control plane: it has
     *  a team-scoped listing (`listForTeam`), which is the test for which side a
     *  table belongs on. Contrast `accessGroups` below, which groups PEOPLE. */
    get collections() {
        return createSupabaseCollectionsRepository(this.controlDb)
    }

    /** Prowl billing — the team's usage ledger (reads; writes go via the
     *  service-role recorder in the metering layer). Control plane, alongside
     *  `subscriptions`: usage is read per team, and keeping it next to the tier it
     *  is checked against means a balance is one query rather than a roll-up. */
    get usage() {
        return createSupabaseUsageRepository(this.controlDb)
    }

    /** The durable billing identities behind teams (0076): who a team's spend
     *  belongs to, which survives the team and the account being deleted. Control
     *  plane — a billing identity is a property of an email, not of a region. */
    get usageSubjects() {
        return createSupabaseUsageSubjectStore(this.controlDb)
    }

    /** May this team spend? The hard gate behind suspension — every route that
     *  dispatches billable work to the analyser asks first (enforced by
     *  lib/server/http/spend-gate.test.ts). */
    get spendGate() {
        return new SpendGate(this.usageSubjects, this.subscriptions)
    }

    /** This period's spend for a team, resolved through its billing subject —
     *  the ONE place that decides what a team's balance means, so the sidebar
     *  pill and the billing page can never disagree. */
    get periodUsage() {
        return new PeriodUsageReader(this.usageSubjects, this.usage)
    }

    // ─── control plane: identity, teams, billing policy ──────────────────────
    get teamMembership() {
        return createSupabaseTeamMembershipRepository(this.controlDb)
    }
    get teams() {
        return createSupabaseTeamsRepository(this.controlDb)
    }
    get teamInvites() {
        return createSupabaseTeamInvitesRepository(this.controlDb)
    }
    /** Access groups (access_groups) — groupings OF people, and the grants that
     *  say which projects a group may see. `access_group_projects` holds project
     *  ids, so under a split that composite FK into `projects(id, team_id)`
     *  becomes a soft reference needing app-side cleanup. It reads ids only and
     *  never joins to `projects`, so the queries themselves survive. */
    get accessGroups() {
        return createSupabaseAccessGroupsRepository(this.controlDb)
    }
    /** Prowl billing — the team's subscription (tier + allowance). Policy, not
     *  metering: it belongs with the customer, not with any one project. */
    get subscriptions() {
        return createSupabaseSubscriptionsRepository(this.controlDb)
    }
    get githubTokens() {
        return createGithubTokenRepository(this.controlDb)
    }
    /** Per-provider user OAuth tokens (provider_tokens) — GitLab today. GitHub
     *  still reads via `githubTokens` (github_tokens table). */
    get providerTokens() {
        return createProviderTokenRepository(this.controlDb)
    }
    get relayWorkers() {
        return createSupabaseRelayWorkerRepository(this.controlDb)
    }
    get notifications() {
        return createSupabaseNotificationFeedRepository(this.controlDb)
    }

    /** Deleting a project completely: regional content, the central suggestions
     *  pointing at it, then the row itself. Assembled here because it is the one
     *  operation that legitimately spans both handles. */
    get projectDeletion() {
        return new ProjectDeletionService(this.projects, this.projectContentPurge, this.issueSuggestions)
    }

    /** The raw CONTROL-plane client — the last remaining escape hatch, used ONLY
     *  where a collaborator still takes a DB handle rather than a repository: the
     *  vcs CommentActions gate. It reads `projects` to decide whether commenting is
     *  allowed, which is control-plane. No route does raw `.from()` on it;
     *  decoupling CommentActions retires this. */
    get client(): SupabaseRlsClient {
        return this.controlDb
    }
}
