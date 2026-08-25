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
import type { CellId } from "@/modules/regions"
import type {
    AnalyserResolver,
    ProjectAnalyserRepository,
    RetrieveHints,
    RetrieveResult,
    NeighboursInput,
    NeighboursResult,
} from "@/modules/analysis"
import type { SpendGate } from "@/modules/billing"
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
 *  indexed, with the analyser graph id to address it by and the cell that holds
 *  it. Both are resolved together in resolve() so the two tool paths below can't
 *  address a graph without also knowing which analyser actually has it. */
export interface ResolvedKnowledgeBase extends KnowledgeBase {
    graphId: string
    cell: CellId
}

/** Reduce a project reference to something comparable.
 *
 *  The point is that the CALLER should not have to learn our naming scheme before
 *  it can ask a question. A coding agent standing in a checkout already has one
 *  identifier for free — `git remote get-url origin` — so that has to resolve, in
 *  every spelling git hands out:
 *
 *      git@github.com:phongpak/bobby-tracker.git   ┐
 *      ssh://git@github.com/phongpak/bobby-tracker ├─→ phongpak/bobby-tracker
 *      https://github.com/phongpak/bobby-tracker/  ┘
 *
 *  Anything that is not a URL (a bare name, a display name, a project uuid) falls
 *  through lowercased and otherwise untouched. */
export function normalizeRepoRef(raw: string): string {
    let ref = raw.trim().toLowerCase()
    ref = ref.replace(/^[a-z][a-z0-9+.-]*:\/\//, "") // scheme://
    ref = ref.replace(/^[^/@]+@/, "") // user@ / user:pass@
    ref = ref.replace(/^([^/:]+):(?!\/)/, "$1/") // scp-style host:owner/repo
    ref = ref.replace(/\.git$/, "").replace(/\/+$/, "")

    const segments = ref.split("/").filter(Boolean)
    // A leading segment with a dot in it is the forge host, not the owner.
    if (segments.length > 2 && segments[0].includes(".")) segments.shift()
    return segments.slice(-2).join("/")
}

/** Narrowing passes, most specific first. The first pass yielding exactly one
 *  match wins; a pass yielding several is reported as ambiguous rather than
 *  silently picking one. */
function matchBase(identifier: string, bases: KnowledgeBase[]): KnowledgeBase {
    const raw = identifier.trim().toLowerCase()
    const needle = normalizeRepoRef(identifier)
    const repoOf = (kb: KnowledgeBase) => normalizeRepoRef(kb.repoFullName ?? "")
    const nameOf = (kb: KnowledgeBase) => kb.name.trim().toLowerCase()
    const tail = (ref: string) => ref.split("/").pop() ?? ""

    const passes: ((kb: KnowledgeBase) => boolean)[] = [
        (kb) => kb.projectId.toLowerCase() === raw,
        (kb) => repoOf(kb) !== "" && repoOf(kb) === needle,
        (kb) => nameOf(kb) === raw || nameOf(kb) === needle,
        // `bobby-tracker` — and `git@github.com:someone-else/bobby-tracker.git` —
        // should both find `phongpak/bobby-tracker`.
        (kb) => repoOf(kb) !== "" && tail(repoOf(kb)) === tail(needle),
        (kb) => nameOf(kb).includes(raw) || (repoOf(kb) !== "" && repoOf(kb).includes(needle)),
    ]

    for (const pass of passes) {
        const matches = bases.filter(pass)
        if (matches.length === 1) return matches[0]
        if (matches.length > 1) {
            throw new McpToolError(
                `"${identifier}" matches several knowledge bases: ${matches
                    .map((m) => m.repoFullName || m.name)
                    .join(", ")}. Re-run with the exact one you mean.`,
            )
        }
    }

    throw new McpToolError(
        `No knowledge base matches "${identifier}". Available: ${bases
            .map((b) => b.repoFullName || b.name)
            .join(", ")}. You can pass any of those, or the output of \`git remote get-url origin\`.`,
    )
}

/** No `project` was given. One indexed base is unambiguous, so use it. Several is
 *  a question only the caller can answer — and the error names them, so the retry
 *  is a single hop instead of a list_knowledge_bases call and a second attempt. */
function soleBase(bases: KnowledgeBase[]): KnowledgeBase {
    const indexed = bases.filter((b) => b.indexed)
    if (indexed.length === 1) return indexed[0]
    if (indexed.length === 0) {
        throw new McpToolError(
            `None of your knowledge bases have finished indexing yet (${bases
                .map((b) => b.repoFullName || b.name)
                .join(", ")}). Read the repository directly for now.`,
        )
    }
    throw new McpToolError(
        `You have ${indexed.length} knowledge bases, so "project" is needed: ${indexed
            .map((b) => b.repoFullName || b.name)
            .join(", ")}. Pass whichever matches the repository you are working in — owner/repo, the repo name, or the output of \`git remote get-url origin\`.`,
    )
}

export class KnowledgeBaseService {
    constructor(
        private readonly access: AccessService,
        private readonly projects: ProjectsRepository,
        private readonly mcpIntegration: ProjectMcpIntegrationRepository,
        private readonly projectAnalyser: ProjectAnalyserRepository,
        private readonly analyserFor: AnalyserResolver,
        private readonly userId: string,
        /** The billing hard gate: a paused team serves no MCP requests either. */
        private readonly spend: SpendGate,
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

    /** Resolve a project reference to a queryable knowledge base.
     *
     *  Accepts a project id, `owner/repo`, a bare repo name, the project's display
     *  name, or a raw git remote URL. The reference is also OPTIONAL: when the
     *  caller has exactly one indexed base there is nothing to disambiguate, and
     *  requiring the argument anyway bought nothing but a list_knowledge_bases
     *  round trip in front of every first question.
     *
     *  Throws McpToolError with actionable guidance when the reference is unknown,
     *  ambiguous, or names a project that isn't indexed. */
    async resolve(identifier?: string): Promise<ResolvedKnowledgeBase> {
        const bases = await this.list()
        if (bases.length === 0) {
            throw new McpToolError(
                "No knowledge bases are available to you. Enable MCP for a project in its Integrations tab in Ucelot, then try again.",
            )
        }

        const given = identifier?.trim() ?? ""
        const hit = given ? matchBase(given, bases) : soleBase(bases)

        // Defence in depth. `list()` already applied both gates, so this cannot
        // fail today — but it keeps the authorization decision local and obvious
        // at the point a project id is about to be handed to the analyser.
        const access = await this.access.canAccessProject(this.userId, hit.projectId)
        if (!access.ok) throw new McpToolError(`No knowledge base matches "${given || hit.name}".`)

        if (!hit.indexed) {
            throw new McpToolError(
                `"${hit.repoFullName || hit.name}" has no knowledge graph yet — it hasn't finished indexing in Ucelot. Fall back to reading files directly for this one.`,
            )
        }

        const graphId = await this.projectAnalyser.findGraphId(hit.projectId)
        if (!graphId) throw new McpToolError(`"${hit.repoFullName || hit.name}" is not indexed yet.`)

        // The graph lives in exactly one cell (0062). An unreadable cell means we
        // cannot say which analyser holds it, and guessing would query a backend
        // that has never indexed this repo — which returns a confidently empty
        // result rather than an error, the worst outcome for an agent to act on.
        const cell = await this.projects.findCell(hit.projectId)
        if (!cell) throw new McpToolError(`"${hit.repoFullName || hit.name}" is not available right now.`)

        // Hard gate (0076). Every MCP tool that costs anything — locate, ask,
        // neighbours — funnels through this resolver, so a stopped team is refused
        // here once rather than in each tool. MCP matters more than the UI paths
        // do: an agent will happily retry in a loop, and nobody is watching, which
        // is exactly how an exhausted allowance would otherwise become an
        // unbounded bill.
        //
        // The gate's message is passed through verbatim. Unlike the public forms,
        // the caller here is the team's own agent, and an agent that is told WHY
        // it was refused can stop and say so instead of retrying.
        const payer = await this.projects.findTeamId(hit.projectId)
        if (!payer) {
            throw new McpToolError(`"${hit.repoFullName || hit.name}" isn't linked to a team that can run analysis.`)
        }
        const refusal = await this.spend.check(payer)
        if (refusal) {
            throw new McpToolError(`"${hit.repoFullName || hit.name}" is unavailable in Ucelot. ${refusal.message}`)
        }

        return { ...hit, graphId, cell }
    }

    /** Ranked file cards for a natural-language goal. */
    async locate(
        identifier: string | undefined,
        query: string,
        hints?: RetrieveHints,
    ): Promise<{ base: ResolvedKnowledgeBase; evidence: RetrieveResult }> {
        const base = await this.resolve(identifier)
        // userId is forwarded for BILLING attribution, not for authorization —
        // access was already decided by resolve() above. Without it the analyser
        // sees only the shared service token and the usage event lands
        // unattributed.
        const evidence = await this.analyserFor(base.cell).retrieve({ repoId: base.graphId, query, hints, userId: this.userId })
        return { base, evidence }
    }

    /** One graph hop from a file, symbol or node id. */
    async neighbours(
        identifier: string | undefined,
        anchor: Pick<NeighboursInput, "nodeId" | "symbol" | "file" | "edges" | "direction" | "limit">,
    ): Promise<{ base: ResolvedKnowledgeBase; graph: NeighboursResult }> {
        const base = await this.resolve(identifier)
        const graph = await this.analyserFor(base.cell).neighbours({ repoId: base.graphId, ...anchor, userId: this.userId })
        return { base, graph }
    }
}
