import { test, expect, describe } from "bun:test"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"

// Invariant: every path that can SPEND money checks whether the team is allowed to.
//
// WHY THIS EXISTS. Suspension (0076) is only worth having if it is enforced, and
// enforcement is spread across ~15 route files plus two analysis services. The
// analyser bills whatever it is asked to do — it has no idea a team is paused —
// so a single dispatch site that forgets to ask is a paused team that keeps
// spending, silently, for as long as nobody looks at the bill.
//
// That is exactly the shape route-authz.test.ts was written for, so this is the
// same trick: the rule is enforced on the SOURCE. A file that reaches the
// analyser must also contain a spend check.
//
// The gate itself is tested in modules/billing/application/SpendGate.test.ts;
// this only proves nobody can skip calling it.

const ROOT = process.cwd()

/** Reaching the analyser at all. */
const DISPATCH = /getAnalyser\s*\(|analyserFor\s*\(/
/** Any of the sanctioned ways to ask "may this team spend?". */
const GATE = /requireSpend\s*\(|getSpendGate\s*\(|this\.spend\.check\s*\(|spendGate\.check\s*\(/

/** Files that reach the analyser WITHOUT spending, each for a stated reason.
 *  A new entry needs one — that is the point of the list. */
const EXEMPT = new Map<string, string>([
    // The composition seam itself: it builds the client, it never calls it.
    ["modules/analysis/Composition.ts", "constructs the adapter; dispatches nothing"],
    // Icon work is free and unattributed — the calls pass no billing tenant, so
    // the analyser records no usage against anyone.
    ["app/api/icons/search/route.ts", "icon search is unbilled (no billing tenant passed)"],
    ["app/api/projects/route.ts", "icon suggester embed only; unbilled, same rule as icons/search"],
    // Teardown and configuration, not model calls.
    ["app/api/projects/[id]/route.ts", "deleteGraph on project deletion — teardown, not a billable call"],
    ["app/api/projects/[id]/branches/[branch]/route.ts", "deleteGraph when a branch is untracked — teardown, not a billable call"],
    ["app/api/projects/[id]/issue-preferences/route.ts", "reads/writes analyser config; no model call"],
    // Type/wiring surfaces that NAME the analyser without ever calling it.
    ["modules/analysis/index.ts", "public contract barrel — re-exports, dispatches nothing"],
    ["modules/analysis/ports/Analyser.ts", "the port declaration itself"],
    ["modules/analysis/infrastructure/HttpAnalyser.ts", "the transport adapter — it IS the call, gated by its callers"],
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

const dispatchers = ["app", "modules"]
    .map((d) => join(ROOT, d))
    .flatMap((root) => sourceFiles(root))
    .map((file) => ({ rel: file.slice(ROOT.length + 1), src: readFileSync(file, "utf8") }))
    .filter((f) => DISPATCH.test(f.src))

describe("spend gate coverage", () => {
    test("the scan actually found dispatch sites", () => {
        // Guards against a rename quietly making the rule below vacuous.
        expect(dispatchers.length).toBeGreaterThan(8)
    })

    test("every file that dispatches to the analyser checks the spend gate", () => {
        const offenders = dispatchers
            .filter((f) => !EXEMPT.has(f.rel) && !GATE.test(f.src))
            .map((f) => `  ${f.rel}\n      reaches the analyser with no spend check`)
        expect(offenders.join("\n") || "none").toBe("none")
    })

    test("exemptions still dispatch — a stale entry is a rule that stopped applying", () => {
        const stale = [...EXEMPT.keys()].filter((rel) => !dispatchers.some((f) => f.rel === rel))
        expect(stale).toEqual([])
    })
})
