// RequestContext — the per-request UNIT OF WORK. It holds the caller's RLS-scoped
// DB handle and hands out module repositories/services already bound to it, so a
// route handler depends on the module CONTRACTS (IssuesRepository, AccessService,
// …) and never touches a DB client itself.
//
// This is the one interface-layer place that knows the concrete Supabase-backed
// factories — composition/wiring. Routes and ApiContext see only the abstractions
// it returns; swapping the store means changing the factories referenced here,
// nothing at a call site.

import type { SupabaseRlsClient } from "@/lib/server/supabase"
import { getAccessService } from "@/modules/access"
import { createSupabaseProjectsRepository, createSupabaseProjectDisplayRepository } from "@/modules/projects"
import { createSupabaseIssuesRepository, createSupabaseIssueCommentsReadRepository } from "@/modules/issues"
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
import { createSupabaseRelayWorkerRepository } from "@/modules/relay"
import { createSupabaseNotificationFeedRepository } from "@/modules/notifications"

export class RequestContext {
    constructor(private readonly db: SupabaseRlsClient) {}

    /** App-layer authorization: roles, project visibility, active-team resolution. */
    get access() {
        return getAccessService(this.db)
    }
    get projects() {
        return createSupabaseProjectsRepository(this.db)
    }
    get issues() {
        return createSupabaseIssuesRepository(this.db)
    }
    get issueComments() {
        return createSupabaseIssueCommentsReadRepository(this.db)
    }
    get projectDisplay() {
        return createSupabaseProjectDisplayRepository(this.db)
    }
    get analyser() {
        return createSupabaseProjectAnalyserRepository(this.db)
    }
    get githubTokens() {
        return createGithubTokenRepository(this.db)
    }
    /** Per-provider user OAuth tokens (provider_tokens) — GitLab today. GitHub
     *  still reads via `githubTokens` (github_tokens table). */
    get providerTokens() {
        return createProviderTokenRepository(this.db)
    }
    get pullRequests() {
        return createSupabasePullRequestReadRepository(this.db)
    }
    get teamMembership() {
        return createSupabaseTeamMembershipRepository(this.db)
    }
    get teams() {
        return createSupabaseTeamsRepository(this.db)
    }
    get teamInvites() {
        return createSupabaseTeamInvitesRepository(this.db)
    }
    get accessGroups() {
        return createSupabaseAccessGroupsRepository(this.db)
    }
    get collections() {
        return createSupabaseCollectionsRepository(this.db)
    }
    get publicSessions() {
        return createSupabasePublicSessionRepository(this.db)
    }
    get sessionsAdmin() {
        return createSupabasePublicSessionAdminRepository(this.db)
    }
    get publicIntegration() {
        return createSupabaseProjectPublicIntegrationRepository(this.db)
    }
    get relayWorkers() {
        return createSupabaseRelayWorkerRepository(this.db)
    }
    get notifications() {
        return createSupabaseNotificationFeedRepository(this.db)
    }

    /** The raw RLS client — the last remaining escape hatch, used ONLY where a
     *  collaborator still takes a DB handle rather than a repository: the vcs
     *  CommentActions gate (comment-authoring routes). No route does raw `.from()`
     *  on it. Decoupling CommentActions retires this. */
    get client(): SupabaseRlsClient {
        return this.db
    }
}
