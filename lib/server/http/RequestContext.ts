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
import { createSupabaseProjectsRepository } from "@/modules/projects"
import { createSupabaseIssuesRepository } from "@/modules/issues"
import { createSupabaseProjectAnalyserRepository } from "@/modules/analysis"
import { createGithubTokenRepository } from "@/modules/vcs"
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
    get analyser() {
        return createSupabaseProjectAnalyserRepository(this.db)
    }
    get githubTokens() {
        return createGithubTokenRepository(this.db)
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

    /** TRANSITIONAL escape hatch — the raw RLS client for routes not yet migrated
     *  to the repositories above. Every use is a data-access leak at the route
     *  layer; this getter is removed once none remain, after which the DB client
     *  never leaves this file or the module adapters. */
    get client(): SupabaseRlsClient {
        return this.db
    }
}
