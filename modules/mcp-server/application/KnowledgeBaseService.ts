// MCP server — the application service behind the tools. It answers "which
// knowledge bases may THIS user reach, and what does the analyser say about one
// of them", and it is the single place the two access rules are enforced:
//
//   1. AUTHORIZATION — the caller must be able to access the project, decided by
//      the same AccessService the browser routes use (team role + group grants).
//   2. EXPOSURE — the project's owner must have switched the MCP integration on
//      (tracker.project_mcp_integration.enabled). Access alone is NOT enough:
//      a project you can see in the UI stays invisible to MCP until enabled.
//
// SECURITY NOTE — why this is careful about `userId`. An MCP request carries an
// OAuth bearer token, not a Supabase session cookie, so the repositories handed to
// this service are bound to the SERVICE-ROLE client and RLS does NOT filter
// anything. Every read here must therefore be constrained by an explicit user id.
// That is exactly what AccessService does: `canAccessProject`/`accessibleProjectIds`
// decide on `team_members.user_id = <userId>` and the caller's group grants, which
// are explicit `.eq(...)` filters rather than an `auth.uid()` RLS predicate. Do not
// add a read here that trusts RLS to scope it.

import type { AccessService } from "@/modules/access"
import type { ProjectsRepository } from "@/modules/projects"
import type { ProjectMcpIntegrationRepository } from "@/modules/mcp"
import type {
    Analyser,
    ProjectAnalyserRepository,
    RetrieveHints,
    RetrieveResult,
    QueryResult,
} from "@/modules/analysis"
import { McpToolError } from "../domain/McpTool"

/** One project exposed over MCP, as the tools describe it. `indexed` is false
 *  until the analyser has built a graph — such a project can be listed but not
 *  queried. */
export interface KnowledgeBase {
    projectId: string
    name: string
    repoFullName: string | null
    description: string | null
    indexed: boolean
}

/** A knowledge base resolved for querying: guaranteed accessible, MCP-enabled and
 *  indexed, with the analyser graph id to address it by. */
export interface ResolvedKnowledgeBase extends KnowledgeBase {
    graphId: string
}

export class KnowledgeBaseService {
    constructor(
        private readonly access: AccessService,
        private readonly projects: ProjectsRepository,
        private readonly mcpIntegration: ProjectMcpIntegrationRepository,
        private readonly projectAnalyser: ProjectAnalyserRepository,
        private readonly analyser: Analyser,
        private readonly userId: string,
    ) {}

    /** Every MCP-enabled project the caller can access, across all their teams.
     *  This is the ONLY enumeration path — the resolver below narrows from it, so
     *  a project that fails either gate can never be addressed by any tool. */
    async list(): Promise<KnowledgeBase[]> {
        const teams = await this.access.listTeams(this.userId)

        // Per team: the caller's project scope ("all" for owner/admin, else the
        // group-granted ids), then that team's projects within it.
        const perTeam = await Promise.all(
            teams.map(async (team) => {
                const scope = await this.access.accessibleProjectIds(team.id, this.userId, team.role)
                if (Array.isArray(scope) && scope.length === 0) return []
                return this.projects.listForTeam(team.id, scope)
            }),
        )

        // A project can only appear under one team, but a user may hold the same
        // project through several groups — dedupe defensively.
        const byId = new Map<string, (typeof perTeam)[number][number]>()
        for (const project of perTeam.flat()) byId.set(project.id, project)
        if (byId.size === 0) return []

        const enabledIds = new Set(await this.mcpIntegration.listEnabledProjectIds([...byId.keys()]))
        const exposed = [...byId.values()].filter((p) => enabledIds.has(p.id))
        if (exposed.length === 0) return []

        // graph_id doubles as the "has been indexed" signal.
        const graphIds = await Promise.all(exposed.map((p) => this.projectAnalyser.findGraphId(p.id)))

        return exposed.map((project, i) => ({
            projectId: project.id,
            name: project.name,
            repoFullName: project.repo_full_name ?? null,
            description: project.description ?? null,
            indexed: Boolean(graphIds[i]),
        }))
    }

    /** Resolve a user-supplied project reference to a queryable knowledge base.
     *  Accepts a project id, `owner/repo`, a bare repo name or the project's
     *  display name. Throws McpToolError with actionable guidance when the
     *  reference is unknown, ambiguous, or names a project that isn't indexed. */
    async resolve(identifier: string): Promise<ResolvedKnowledgeBase> {
        const needle = identifier.trim().toLowerCase()
        if (!needle) throw new McpToolError("No project given. Call list_knowledge_bases to see the available ones.")

        const bases = await this.list()
        if (bases.length === 0) {
            throw new McpToolError(
                "No knowledge bases are available to you. Enable MCP for a project in its Integrations tab in Ocelot, then try again.",
            )
        }

        // Narrowing passes, most specific first. The first pass that yields exactly
        // one match wins; a pass yielding several is reported as ambiguous rather
        // than silently picking one.
        const passes: ((kb: KnowledgeBase) => boolean)[] = [
            (kb) => kb.projectId.toLowerCase() === needle,
            (kb) => (kb.repoFullName ?? "").toLowerCase() === needle,
            (kb) => kb.name.toLowerCase() === needle,
            // `bobby-tracker` should find `phongpak/bobby-tracker`.
            (kb) => (kb.repoFullName ?? "").toLowerCase().split("/").pop() === needle,
            (kb) => kb.name.toLowerCase().includes(needle) || (kb.repoFullName ?? "").toLowerCase().includes(needle),
        ]

        let matches: KnowledgeBase[] = []
        for (const pass of passes) {
            matches = bases.filter(pass)
            if (matches.length === 1) break
            if (matches.length > 1) {
                throw new McpToolError(
                    `"${identifier}" matches several knowledge bases: ${matches
                        .map((m) => m.repoFullName || m.name)
                        .join(", ")}. Re-run with the exact one you mean.`,
                )
            }
        }

        const hit = matches[0]
        if (!hit) {
            throw new McpToolError(
                `No knowledge base matches "${identifier}". Available: ${bases
                    .map((b) => b.repoFullName || b.name)
                    .join(", ")}.`,
            )
        }

        // Defence in depth. `list()` already applied both gates, so this cannot
        // fail today — but it keeps the authorization decision local and obvious
        // at the point a project id is about to be handed to the analyser.
        const access = await this.access.canAccessProject(this.userId, hit.projectId)
        if (!access.ok) throw new McpToolError(`No knowledge base matches "${identifier}".`)

        if (!hit.indexed) {
            throw new McpToolError(
                `"${hit.repoFullName || hit.name}" has no knowledge graph yet — it hasn't finished indexing in Ocelot. Fall back to reading files directly for this one.`,
            )
        }

        const graphId = await this.projectAnalyser.findGraphId(hit.projectId)
        if (!graphId) throw new McpToolError(`"${hit.repoFullName || hit.name}" is not indexed yet.`)

        return { ...hit, graphId }
    }

    /** Ranked files + grounded pinpoints for a natural-language goal. */
    async locate(
        identifier: string,
        query: string,
        hints?: RetrieveHints,
    ): Promise<{ base: ResolvedKnowledgeBase; evidence: RetrieveResult }> {
        const base = await this.resolve(identifier)
        const evidence = await this.analyser.retrieve({ repoId: base.graphId, query, hints })
        return { base, evidence }
    }

    /** A grounded natural-language answer about the codebase. */
    async ask(identifier: string, question: string): Promise<{ base: ResolvedKnowledgeBase; answer: QueryResult }> {
        const base = await this.resolve(identifier)
        const answer = await this.analyser.query(base.graphId, question)
        return { base, answer }
    }
}
