import { test, expect, describe } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

// Predicate coverage for every repository query — the second half of the
// invariant that replaces RLS.
//
// WHY THIS EXISTS. route-authz.test.ts proves a caller was authorised to reach a
// tenant's data. It says nothing about what the query then returns.
// `projects.listAllNames()` was `select("id,name")` with no predicate at all: the
// guard proved you belonged to *a* team, and the query handed back every project
// in the installation. Under RLS that was invisible, because the caller's own
// credentials narrowed it. With a service-role client it is a full disclosure.
//
// THE RULE: a query against a tenant table must narrow itself. Not "must narrow
// itself correctly" — a static scan cannot know which column is the right tenant
// key — but it must carry SOME predicate. A statement with none is unambiguously
// "the whole table", and that is never what a repository method means to say.
//
// The same rule catches a worse mistake in the other direction: an UPDATE or
// DELETE with no predicate rewrites or empties the table.

const MODULES_DIR = join(import.meta.dir, "..", "..", "..", "modules")

/** Tables that are genuinely global — no tenant to scope them to, so reading all
 *  of one is the point rather than a leak.
 *
 *  The beta tables (0074) are installation-wide by construction: an invitation is
 *  attached to an email address, not to a team, and the only readers are the
 *  enrolment gate (which looks up ONE address by equality) and the staff surface
 *  at /api/beta/allowlist, whose entire job is to show the list. Both tables have
 *  RLS on with no policies, so "reachable at all" is already a service-role-only
 *  question. */
const GLOBAL_TABLES = new Set([
    "icon_catalog", "icon_catalog_meta", "icon_search_cache", "app_config",
    "beta_allowlist", "beta_requests",
    // deleted_account_usage (0075) is keyed by a hash of an email and belongs to
    // no team by construction — the account it describes has been deleted. Its
    // sweep is a deliberate table-wide `delete where expires_at < now()`, which
    // is the shape the keyed-mutation rule exists to catch; it is exempt because
    // enforcing retention IS the statement, and this stack has no scheduler to
    // do it anywhere else.
    "deleted_account_usage",
])

/** Anything that narrows a statement. Deliberately broad: the test is looking for
 *  the total absence of a predicate, not judging which column is correct. */
const PREDICATES = [".eq(", ".in(", ".match(", ".filter(", ".or(", ".neq(", ".gt(", ".gte(", ".lt(", ".lte(", ".is(", ".contains(", ".overlaps(", ".like(", ".ilike("]

function adapterFiles(dir: string): string[] {
    const out: string[] = []
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name)
        if (entry.isDirectory()) out.push(...adapterFiles(full))
        else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts") && full.includes("/infrastructure/")) {
            out.push(full)
        }
    }
    return out
}

/** Split a class body into its methods. Crude on purpose — it only needs to
 *  bracket each `.from(...)` chain with the method that owns it. */
function methods(src: string): { name: string; body: string }[] {
    const re = /^\s{4}(?:private\s+|public\s+)?(?:async\s+)?([A-Za-z_][\w]*)\s*\(/gm
    const starts: { name: string; at: number }[] = []
    for (let m = re.exec(src); m; m = re.exec(src)) starts.push({ name: m[1], at: m.index })
    return starts.map((s, i) => ({
        name: s.name,
        body: src.slice(s.at, i + 1 < starts.length ? starts[i + 1].at : undefined),
    }))
}

type Kind = "read" | "mutation" | "insert"

interface Query {
    where: string
    table: string
    kind: Kind
    narrowed: boolean
    /** Narrowed by a KEY (eq/in/match), not merely by a status filter. */
    keyed: boolean
}

const queries: Query[] = adapterFiles(MODULES_DIR).flatMap((path) => {
    const src = readFileSync(path, "utf8")
    const rel = path.slice(path.indexOf("modules/"))
    return methods(src).flatMap((m) => {
        const tables = [...m.body.matchAll(/\.from\("([a-z_]+)"\)/g)].map((x) => x[1])
        if (tables.length === 0) return []
        const narrowed = PREDICATES.some((p) => m.body.includes(p))
        const keyed = [".eq(", ".in(", ".match("].some((p) => m.body.includes(p))
        // Order matters. An insert/upsert has no `where` by definition, and its
        // trailing `.select()` is a RETURNING clause rather than a query — so it
        // is classified first and exempted. Only after that does a `.delete()` or
        // `.update(` mean a statement that must narrow itself.
        const kind: Kind = /\.insert\(|\.upsert\(/.test(m.body)
            ? "insert"
            : /\.delete\(\)|\.update\(/.test(m.body)
              ? "mutation"
              : "read"
        return tables
            .filter((t) => !GLOBAL_TABLES.has(t))
            .map((table) => ({ where: `${rel} › ${m.name}()`, table, kind, narrowed, keyed }))
    })
})

describe("repository query scoping", () => {
    test("the scan actually found queries", () => {
        expect(queries.length).toBeGreaterThan(80)
    })

    // The leak shape: a guard proved you belong to a team, then the query returns
    // every tenant's rows because it never said which.
    test("no read returns a whole tenant table", () => {
        const offenders = [...new Set(
            queries.filter((q) => q.kind === "read" && !q.narrowed).map((q) => `  ${q.where}  →  select from "${q.table}" with NO predicate`),
        )].sort()
        expect(offenders.join("\n") || "none").toBe("none")
    })

    // The destructive shape. Stricter than the read rule on purpose: a mutation
    // must be keyed, not merely filtered. `markAllRead()` carried
    // `.is("read_at", null)` and no owner — enough to look narrowed, enough to
    // mark every user's notifications read.
    test("no update or delete runs without a KEYED predicate", () => {
        const keyed = [".eq(", ".in(", ".match("]
        const offenders = [...new Set(
            queries
                .filter((q) => q.kind === "mutation" && !q.keyed)
                .map((q) => `  ${q.where}  →  writes "${q.table}" with no keyed predicate`),
        )].sort()
        expect(offenders.join("\n") || "none").toBe("none")
        expect(keyed.length).toBe(3) // documents what "keyed" means
    })
})
