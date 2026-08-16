import { test, expect, describe } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

// Guard coverage for every API route — the invariant that replaces RLS as the
// backstop.
//
// WHY THIS EXISTS. Authorization in this app is TWO systems that must agree:
// coarse RLS at the database (is_team_member — any team member, any team
// project) and the real rule in AccessService (a plain member sees only projects
// granted to one of their groups). Because the coarse net catches most mistakes,
// a route that forgot its check kept working, and nobody found out. Two live
// leaks survived that way — POST /api/issues took project_id straight from the
// request body, and the collections issue feed leaned on RLS returning null for
// a non-member.
//
// Under a regional split the data plane is reached with a service-role client,
// which bypasses RLS entirely, so that net is gone. This test is the replacement:
// it fails in CI, loudly and by name, instead of silently papering over a missing
// check at runtime.
//
// THE RULE: a route that reaches a TENANT-scoped repository must carry a
// tenant-scoped guard. requireUser proves who is calling, not what they may see,
// so it is never sufficient on its own for tenant data.
//
// Not covered here, deliberately: routes that never touch `ctx` — webhooks
// (signature-verified), the internal analyser callbacks (shared bearer),
// public-issue routes (session-token gated) and the public SVG endpoints. They
// authenticate by other means and use a service-role client directly, so the
// `ctx.<repo>` scan simply doesn't see them.

const API_DIR = join(import.meta.dir, "..", "..", "..", "app", "api")

/** Repositories holding data owned by a TEAM. Reaching one means proving the
 *  caller belongs to that team — and, for projects, to a group granted it. */
const TENANT_REPOS = [
    "projects", "issues", "issueComments", "pullRequests", "collections",
    "publicSessions", "sessionsAdmin", "publicIntegration", "mcpIntegration",
    "analyser", "issueSuggestions", "accessGroups", "teamInvites",
    "subscriptions", "usage", "projectDisplay",
] as const

/** Repositories keyed by the CALLER'S OWN user id. requireUser is the correct and
 *  complete guard for these — there is no other tenant to confuse them with. */
const USER_SCOPED_REPOS = ["githubTokens", "providerTokens", "relayWorkers", "notifications", "teams", "teamMembership"] as const

/** Guards that establish a tenant, not just an identity.
 *
 *  Two families, both legitimate. The `require*` helpers on ApiContext take the
 *  team from the request header; the `access.*` calls take it from a path
 *  parameter, which is what the /api/teams/[id]/* routes need — the header names
 *  the ACTIVE team, and those routes act on a named one. */
const TENANT_GUARDS = [
    "requireTeam", "requireRole", "requireProjectAccess",
    "requireIssueAccess", "requireCollectionAccess", "requireSessionAccess",
    "access.teamRole", "access.canAccessProject", "access.accessibleProjectIds",
] as const

function routeFiles(dir: string): string[] {
    const out: string[] = []
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name)
        if (entry.isDirectory()) out.push(...routeFiles(full))
        else if (entry.name === "route.ts") out.push(full)
    }
    return out
}

interface RouteFacts {
    path: string
    tenantRepos: string[]
    guards: string[]
}

/** Split a route file into its exported HTTP handlers.
 *
 *  Per-handler, not per-file. A file-level scan passes a module whose PATCH is
 *  guarded and whose GET is not — which is exactly the shape two real gaps had
 *  (`groups/[id]` and `sessions/[id]` both guarded their writes and left the read
 *  on requireUser). Anything before the first handler is module-level and belongs
 *  to none of them. */
function handlers(src: string): { method: string; body: string }[] {
    const re = /export\s+async\s+function\s+(GET|POST|PUT|PATCH|DELETE)\b/g
    const starts: { method: string; at: number }[] = []
    for (let m = re.exec(src); m; m = re.exec(src)) starts.push({ method: m[1], at: m.index })
    return starts.map((s, i) => ({
        method: s.method,
        body: src.slice(s.at, i + 1 < starts.length ? starts[i + 1].at : undefined),
    }))
}

const routes: RouteFacts[] = routeFiles(API_DIR).flatMap((path) => {
    const src = readFileSync(path, "utf8")
    const rel = path.slice(path.indexOf("app/api/"))
    return handlers(src).map((h) => ({
        path: `${rel}  [${h.method}]`,
        tenantRepos: TENANT_REPOS.filter((r) => new RegExp(`ctx\\.${r}\\b`).test(h.body)),
        guards: TENANT_GUARDS.filter((g) => h.body.includes(g)),
    }))
})

describe("route authorization coverage", () => {
    // Sanity: if the scan finds nothing, the rule below is vacuously true and
    // would keep passing after someone moves the directory.
    test("the scan actually found routes", () => {
        expect(routes.length).toBeGreaterThan(50)
        expect(routes.filter((r) => r.tenantRepos.length > 0).length).toBeGreaterThan(20)
    })

    test("every route touching tenant data carries a tenant guard", () => {
        const offenders = routes
            .filter((r) => r.tenantRepos.length > 0 && r.guards.length === 0)
            .map((r) => `  ${r.path}\n      reaches: ${r.tenantRepos.join(", ")}\n      guards:  requireUser only`)

        // Named rather than counted, so the failure tells you what to fix.
        expect(offenders.join("\n") || "none").toBe("none")
    })
})

describe("guard vocabulary", () => {
    // Catches a typo'd or renamed guard silently disabling the rule above: if a
    // guard name in TENANT_GUARDS no longer exists in ApiContext, every route
    // using it would read as unguarded — or worse, still pass while checking
    // nothing.
    const apiContext = readFileSync(join(import.meta.dir, "ApiContext.ts"), "utf8")

    const accessService = readFileSync(
        join(import.meta.dir, "..", "..", "..", "modules", "access", "application", "AccessService.ts"), "utf8")

    for (const guard of TENANT_GUARDS) {
        test(`${guard} still exists`, () => {
            const [owner, method] = guard.includes(".") ? guard.split(".") : ["ApiContext", guard]
            const src = owner === "ApiContext" ? apiContext : accessService
            expect(src).toContain(`${method}(`)
        })
    }

    // The two repo lists must stay disjoint, or a table could be classified as
    // user-scoped (requireUser is enough) and tenant-scoped at once.
    test("tenant and user-scoped repo lists don't overlap", () => {
        const overlap = TENANT_REPOS.filter((r) => (USER_SCOPED_REPOS as readonly string[]).includes(r))
        expect(overlap).toEqual([])
    })
})
