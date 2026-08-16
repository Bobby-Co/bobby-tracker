// Characterization tests for KnowledgeBaseService — the gate that decides which
// knowledge bases an MCP caller can reach.
//
// This matters more than a typical service test: MCP requests run on the
// SERVICE-ROLE client, so RLS is not filtering anything underneath. The rules
// pinned here ARE the access boundary. The two that must never regress:
//
//   • a project the caller can access but has NOT enabled for MCP is invisible
//     and unresolvable, and
//   • enumeration and resolution share one path, so nothing can be addressed
//     that list() wouldn't have shown.

import { test, expect, describe, mock, beforeEach } from "bun:test"
import { KnowledgeBaseService } from "./KnowledgeBaseService"
import { McpToolError } from "../domain/McpTool"

const access = { listTeams: mock(), accessibleProjectIds: mock(), canAccessProject: mock() }
const projects = { listForTeam: mock(), findCell: mock() }
const mcpIntegration = { listEnabledProjectIds: mock() }
const analyser = { findGraphId: mock() }
const analyserPort = { retrieve: mock(), neighbours: mock() }
// The service now takes a RESOLVER (cell → Analyser) rather than a fixed
// Analyser. Recording the cell it asks for is how the tests below assert that a
// tool call is routed to the cell actually holding the graph.
const analyserFor = mock(() => analyserPort)

// The service takes PORTS by constructor (no DB client, no RequestContext), so
// plain mocks are enough — no module mocking needed.
const svc = () =>
    new KnowledgeBaseService(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        access as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        projects as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        mcpIntegration as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        analyser as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        analyserFor as any,
        "u1",
    )

const project = (id: string, name: string, repo: string | null) => ({
    id,
    name,
    repo_full_name: repo,
    description: null,
})

beforeEach(() => {
    access.listTeams.mockReset()
    access.accessibleProjectIds.mockReset()
    access.canAccessProject.mockReset()
    projects.listForTeam.mockReset()
    projects.findCell.mockReset()
    mcpIntegration.listEnabledProjectIds.mockReset()
    analyser.findGraphId.mockReset()
    analyserPort.retrieve.mockReset()
    analyserPort.neighbours.mockReset()
    analyserFor.mockClear()

    // Default happy path: one team, admin, two projects, both indexed.
    access.listTeams.mockResolvedValue([{ id: "t1", role: "admin", is_personal: true }])
    access.accessibleProjectIds.mockResolvedValue("all")
    access.canAccessProject.mockResolvedValue({ ok: true, teamId: "t1", role: "admin" })
    projects.listForTeam.mockResolvedValue([
        project("p1", "Tracker", "phongpak/bobby-tracker"),
        project("p2", "Analyser", "phongpak/bobby-analyser"),
    ])
    mcpIntegration.listEnabledProjectIds.mockResolvedValue(["p1", "p2"])
    analyser.findGraphId.mockResolvedValue("graph-x")
    projects.findCell.mockResolvedValue("ashburn-0")
})

describe("list — exposure filtering", () => {
    test("returns only MCP-enabled projects", async () => {
        mcpIntegration.listEnabledProjectIds.mockResolvedValue(["p2"])
        const bases = await svc().list()
        expect(bases.map((b) => b.projectId)).toEqual(["p2"])
    })

    test("is empty when nothing is enabled, even though both are accessible", async () => {
        mcpIntegration.listEnabledProjectIds.mockResolvedValue([])
        expect(await svc().list()).toEqual([])
    })

    test("skips a team where the member's project scope is empty, without querying it", async () => {
        access.accessibleProjectIds.mockResolvedValue([])
        expect(await svc().list()).toEqual([])
        expect(projects.listForTeam).not.toHaveBeenCalled()
    })

    test("marks a project with no graph as not indexed", async () => {
        projects.listForTeam.mockResolvedValue([project("p1", "Tracker", "phongpak/bobby-tracker")])
        mcpIntegration.listEnabledProjectIds.mockResolvedValue(["p1"])
        analyser.findGraphId.mockResolvedValue(null)
        const [base] = await svc().list()
        expect(base.indexed).toBe(false)
    })

    test("dedupes a project reachable through several teams", async () => {
        access.listTeams.mockResolvedValue([
            { id: "t1", role: "admin", is_personal: true },
            { id: "t2", role: "member", is_personal: false },
        ])
        projects.listForTeam.mockResolvedValue([project("p1", "Tracker", "phongpak/bobby-tracker")])
        mcpIntegration.listEnabledProjectIds.mockResolvedValue(["p1"])
        const bases = await svc().list()
        expect(bases).toHaveLength(1)
    })
})

describe("resolve — identifier matching", () => {
    test("matches an exact project id", async () => {
        expect((await svc().resolve("p2")).projectId).toBe("p2")
    })

    test("matches owner/repo", async () => {
        expect((await svc().resolve("phongpak/bobby-analyser")).projectId).toBe("p2")
    })

    test("matches the display name, case-insensitively", async () => {
        expect((await svc().resolve("tracker")).projectId).toBe("p1")
    })

    test("matches a bare repo name", async () => {
        expect((await svc().resolve("bobby-analyser")).projectId).toBe("p2")
    })

    // The caller standing in a checkout has one identifier for free. Every
    // spelling git hands out has to resolve, or it goes back to guessing ours.
    test.each([
        "git@github.com:phongpak/bobby-analyser.git",
        "https://github.com/phongpak/bobby-analyser",
        "https://github.com/phongpak/bobby-analyser.git",
        "ssh://git@github.com/phongpak/bobby-analyser.git",
        "https://github.com/phongpak/bobby-analyser/",
        "PHONGPAK/BOBBY-ANALYSER",
    ])("matches the git remote %s", async (remote) => {
        expect((await svc().resolve(remote)).projectId).toBe("p2")
    })

    // A fork or a mirror has a different owner but the same repo name — the tail
    // pass should still land it rather than sending the caller to list().
    test("matches on repo name when the owner differs", async () => {
        expect((await svc().resolve("git@github.com:someone-else/bobby-analyser.git")).projectId).toBe("p2")
    })

    test("carries the analyser graph id through", async () => {
        analyser.findGraphId.mockResolvedValue("graph-42")
        expect((await svc().resolve("p1")).graphId).toBe("graph-42")
    })

    test("reports ambiguity instead of guessing", async () => {
        projects.listForTeam.mockResolvedValue([
            project("p1", "api", "acme/api-server"),
            project("p2", "api-gateway", "acme/api-gateway"),
        ])
        // "api" hits both on the substring pass; neither exact pass singles one out.
        await expect(svc().resolve("api-")).rejects.toThrow(McpToolError)
    })

    test("lists the alternatives when nothing matches", async () => {
        await expect(svc().resolve("nope")).rejects.toThrow(/No knowledge base matches/)
    })

    test("guides the user when they have no knowledge bases at all", async () => {
        mcpIntegration.listEnabledProjectIds.mockResolvedValue([])
        await expect(svc().resolve("anything")).rejects.toThrow(/Integrations tab/)
    })

    test("refuses an un-indexed project with a fallback hint", async () => {
        analyser.findGraphId.mockResolvedValue(null)
        await expect(svc().resolve("p1")).rejects.toThrow(/hasn't finished indexing/)
    })
})

describe("resolve — the access boundary", () => {
    test("a project that is accessible but NOT MCP-enabled cannot be resolved by id", async () => {
        mcpIntegration.listEnabledProjectIds.mockResolvedValue(["p1"])
        await expect(svc().resolve("p2")).rejects.toThrow(/No knowledge base matches/)
    })

    test("denies when the access check fails, even if the project was listed", async () => {
        // Defence in depth: list() and canAccessProject disagreeing must deny.
        access.canAccessProject.mockResolvedValue({ ok: false, teamId: "t1", role: "member" })
        await expect(svc().resolve("p1")).rejects.toThrow(McpToolError)
    })

})

// `project` is optional so the common case — one indexed codebase — costs no
// round trip at all, and the uncommon case costs exactly one corrected retry
// rather than a list_knowledge_bases call followed by a second attempt.
describe("resolve — no identifier given", () => {
    test("uses the only indexed knowledge base", async () => {
        projects.listForTeam.mockResolvedValue([project("p1", "Tracker", "phongpak/bobby-tracker")])
        mcpIntegration.listEnabledProjectIds.mockResolvedValue(["p1"])
        expect((await svc().resolve()).projectId).toBe("p1")
        expect((await svc().resolve("   ")).projectId).toBe("p1")
    })

    test("ignores un-indexed bases when deciding there is only one", async () => {
        analyser.findGraphId.mockImplementation(async (id: string) => (id === "p2" ? "graph-x" : null))
        expect((await svc().resolve()).projectId).toBe("p2")
    })

    test("names the candidates instead of guessing when there are several", async () => {
        await expect(svc().resolve()).rejects.toThrow(/bobby-tracker.*bobby-analyser/s)
        await expect(svc().resolve()).rejects.toThrow(/git remote get-url origin/)
    })

    test("says so when nothing has finished indexing", async () => {
        analyser.findGraphId.mockResolvedValue(null)
        await expect(svc().resolve()).rejects.toThrow(/finished indexing/)
    })
})

describe("locate / neighbours — delegation", () => {
    test("locate addresses the analyser by graph id, not project id", async () => {
        analyser.findGraphId.mockResolvedValue("graph-7")
        analyserPort.retrieve.mockResolvedValue({ files: [], symbols: [], notes: [], clusters: [] })
        await svc().locate("p1", "where is auth", { symbols: ["Verify"] })
        // userId rides along for BILLING attribution: the analyser authenticates
        // with a shared service token, so without it every MCP usage event lands
        // unattributed (and, before the uuid guard, was dropped outright).
        expect(analyserPort.retrieve).toHaveBeenCalledWith({
            repoId: "graph-7",
            query: "where is auth",
            hints: { symbols: ["Verify"] },
            userId: "u1",
        })
    })

    test("neighbours forwards the anchor under the resolved graph id", async () => {
        analyser.findGraphId.mockResolvedValue("graph-7")
        analyserPort.neighbours.mockResolvedValue({ anchors: [], neighbours: [] })
        await svc().neighbours("p1", { symbol: "Verify", direction: "in", edges: ["CALLS"] })
        expect(analyserPort.neighbours).toHaveBeenCalledWith({
            repoId: "graph-7",
            symbol: "Verify",
            direction: "in",
            edges: ["CALLS"],
            userId: "u1",
        })
    })

    test("an unresolvable project never reaches the analyser", async () => {
        await expect(svc().locate("ghost", "q")).rejects.toThrow(McpToolError)
        expect(analyserPort.retrieve).not.toHaveBeenCalled()
    })
})
