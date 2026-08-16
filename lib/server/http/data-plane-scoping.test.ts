// Invariant: REGIONAL tables are only ever reached through a data-plane client.
//
// The regional split has one failure mode that no type can catch and no test of
// behaviour will notice: a write that goes to the right table in the WRONG
// database. It succeeds. It returns no error. The rows land somewhere nothing
// will read them from, and with no scheduler in this stack, nothing comes along
// later to reconcile them. The symptom surfaces days afterwards as "my issues
// are missing", pointing at the reader rather than the writer.
//
// So the rule is enforced on the source: a file that names a regional table must
// get its client from a sanctioned data-plane source, not from Supabase.service()
// (which is, by definition, the CONTROL database).
//
// Sanctioned sources:
//   • RequestContext's `dataDb` — bound by the guard that authenticated the request
//   • dataClientForProject / dataClientForCell — for the guardless paths
//     (webhooks, analyser callbacks, public submission)
//   • an injected client parameter, for the stores themselves
//
// This is the same shape as route-authz.test.ts and repository-scoping.test.ts:
// two CI invariants that replaced what RLS used to enforce. This is the third,
// and it replaces what a single database used to make impossible.

import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"

/** The seven tables that move with a team's region (0064). Kept as a literal
 *  rather than derived: if a new regional table is added, this list should be a
 *  deliberate edit, with the audit that implies. */
const REGIONAL_TABLES = [
    "issues",
    "issue_comments",
    "issue_embeddings",
    "mind_context",
    "pr_comments",
    "pull_request_analyses",
    "pull_requests",
]

/** Files allowed to pair a regional table with a central client.
 *
 *  Each entry is a decision, not a suppression — a new one needs a reason here. */
const ALLOWED = new Set([
    // The resolver itself: it reads `projects` (control) to FIND the region.
    "lib/server/regional.ts",
    // Defines the planes; the whole file is the seam.
    "lib/server/http/RequestContext.ts",
    // The four regional STORES. Each takes its data client as a parameter and
    // falls back to central only when none is passed — the fallback is the
    // documented "this project's team has not moved" case. Their CALLERS are
    // what this test really polices, and those are not exempt.
    "modules/issues/infrastructure/IssueSyncStore.ts",
    "modules/issues/infrastructure/SupabaseEmbeddingIndex.ts",
    "modules/vcs/infrastructure/SupabasePullRequestStore.ts",
    "modules/analysis/infrastructure/SupabasePullRequestAnalysisStore.ts",
])

function sourceFiles(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
        if (entry === "node_modules" || entry === ".next" || entry.startsWith(".")) continue
        const full = join(dir, entry)
        if (statSync(full).isDirectory()) sourceFiles(full, out)
        else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full)
    }
    return out
}

const ROOT = process.cwd()
const ROOTS = ["app", "modules", "lib"].map((d) => join(ROOT, d))

describe("regional tables are never written through the control client", () => {
    const offenders: { file: string; table: string }[] = []

    for (const root of ROOTS) {
        for (const file of sourceFiles(root)) {
            const rel = file.slice(ROOT.length + 1)
            if (ALLOWED.has(rel)) continue
            const src = readFileSync(file, "utf8")

            // Which local names hold a CENTRAL client? Co-occurrence is not enough
            // to accuse a file: these routes legitimately hold both, using the
            // central client for `projects`/`public_sessions` and a regional one
            // for the content. Only an actual pairing of a central NAME with a
            // regional TABLE is a defect.
            const central = [...src.matchAll(/(?:const|let)\s+(\w+)\s*=\s*(?:await\s+)?Supabase\.service\(\)/g)].map(
                (m) => m[1],
            )
            if (src.includes("Supabase.service()") && central.length === 0) central.push("this.svc")
            if (central.length === 0) continue

            for (const name of central) {
                for (const table of REGIONAL_TABLES) {
                    // `svc.from("issues")` and the wrapped `await svc\n  .from("issues")`
                    const pattern = new RegExp(
                        `\\b${name.replace(".", "\\.")}\\s*(?:\\r?\\n\\s*)?\\.from\\("${table}"\\)`,
                    )
                    if (pattern.test(src)) offenders.push({ file: rel, table })
                }
            }
        }
    }

    test("no file pairs Supabase.service() with a regional table", () => {
        const detail = offenders.map((o) => `  ${o.file} → ${o.table}`).join("\n")
        expect(
            offenders.length === 0 ? "" : `\nRegional tables reached through the CONTROL client:\n${detail}\n\n` +
                `Get the client from dataClientForProject(projectId) (lib/server/regional.ts),\n` +
                `or accept one as a parameter. Supabase.service() is the CENTRAL database.\n`,
        ).toBe("")
    })
})

describe("the regional table list is meaningful", () => {
    // Guards the guard: if RequestContext stops routing these through dataDb, the
    // list above is describing something that no longer exists.
    test("RequestContext still has a distinct data plane", () => {
        const src = readFileSync(join(ROOT, "lib/server/http/RequestContext.ts"), "utf8")
        expect(src).toContain("this.dataDb")
        expect(src).toContain("bindCell")
        // The fail-closed default is the property worth pinning: losing it turns
        // every missed binding into a silent central read.
        expect(src).toMatch(/data plane accessed before a region was bound/)
    })
})
