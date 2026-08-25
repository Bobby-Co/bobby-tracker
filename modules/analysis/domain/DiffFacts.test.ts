import { test, expect, describe } from "bun:test"
import { changedExportedSymbols, mentionedSymbol, mentionsSymbol, touchesMigration } from "./DiffFacts"

const file = (path: string, patch: string, over: { status?: string; previous_path?: string } = {}) => ({
    path,
    patch,
    ...over,
})

describe("changedExportedSymbols", () => {
    test("catches a removed exported Go func", () => {
        const patch = ["@@ -10,3 +10,1 @@", "-func ResolveSession(id string) error {", "-\treturn nil", "-}"].join("\n")
        expect(changedExportedSymbols([file("internal/auth/session.go", patch)])).toEqual(["ResolveSession"])
    })

    test("ignores an unexported Go func", () => {
        const patch = "@@ -1 +1 @@\n-func resolveSession(id string) error {"
        expect(changedExportedSymbols([file("internal/auth/session.go", patch)])).toEqual([])
    })

    test("catches a TS signature change on both sides once", () => {
        const patch = [
            "@@ -4,1 +4,1 @@",
            "-export function findUser(id: string): User {",
            "+export function findUser(id: string, team: string): User {",
        ].join("\n")
        expect(changedExportedSymbols([file("lib/users.ts", patch)])).toEqual(["findUser"])
    })

    // TS/JS has no syntactic marker for "private at module scope", so a name
    // without a leading underscore counts — the same approximation the analyser's
    // factscan makes. It over-triggers, which costs a re-judgement rather than a
    // carried defect, and that is the direction this whole rule leans.
    test("a TS definition without the export keyword still counts", () => {
        const patch = "@@ -1 +1 @@\n-function findUser(id: string) {"
        expect(changedExportedSymbols([file("lib/users.ts", patch)])).toEqual(["findUser"])
    })

    test("...but a leading underscore is honoured as private", () => {
        const patch = "@@ -1 +1 @@\n-function _internalHelper(id: string) {"
        expect(changedExportedSymbols([file("lib/users.ts", patch)])).toEqual([])
    })

    test("catches exported interfaces and types — a renamed field reaches every reader", () => {
        const patch = ["@@ -1,2 +1,2 @@", "-export interface TaskRow {", "+export interface TaskRow {", "-  tenant_id: string", "+  team_id: string"].join("\n")
        expect(changedExportedSymbols([file("lib/types.ts", patch)])).toEqual(["TaskRow"])
    })

    test("catches an added export — the deviation from factscan is deliberate", () => {
        const patch = "@@ -0,0 +1 @@\n+export const buildInvite = (t: Team) => t.id"
        expect(changedExportedSymbols([file("lib/invites.ts", patch)])).toEqual(["buildInvite"])
    })

    test("python: a leading underscore is private", () => {
        const patch = "@@ -1,2 +1,2 @@\n-def _helper(x):\n-def Handler(x):"
        expect(changedExportedSymbols([file("app/views.py", patch)])).toEqual(["Handler"])
    })

    test("is sorted and de-duplicated across files", () => {
        const a = file("a.go", "@@\n-func Zebra() {")
        const b = file("b.go", "@@\n-func Apple() {\n+func Apple(x int) {")
        expect(changedExportedSymbols([a, b])).toEqual(["Apple", "Zebra"])
    })

    test("a rename with no patch still names the file's stem", () => {
        const f = { path: "lib/new-name.ts", previous_path: "lib/OldName.ts", status: "renamed", patch: "" }
        expect(changedExportedSymbols([f])).toEqual(["OldName"])
    })

    test("survives an empty or missing patch", () => {
        expect(changedExportedSymbols([{ path: "bin.png" }])).toEqual([])
    })
})

describe("mentionsSymbol", () => {
    test("matches a whole identifier", () => {
        expect(mentionsSymbol("SQL injection in searchTasks", "searchTasks")).toBe(true)
    })

    // The failure this prevents: a changed `findUser` re-judging every finding
    // that happens to mention `findUserById`, which is a different symbol.
    test("does not match inside a longer identifier", () => {
        expect(mentionsSymbol("calls findUserById on every hit", "findUser")).toBe(false)
    })

    test("is case-sensitive — identifiers are", () => {
        expect(mentionsSymbol("get the user", "Get")).toBe(false)
    })

    test("matches across punctuation the way code is written", () => {
        expect(mentionsSymbol("ctx.resolveSession(id) returns null", "resolveSession")).toBe(true)
    })

    test("an empty symbol matches nothing", () => {
        expect(mentionsSymbol("anything", "")).toBe(false)
    })
})

describe("mentionedSymbol", () => {
    test("names WHICH symbol matched, so a round can say why", () => {
        expect(mentionedSymbol("breaks resolveSession for team owners", ["findUser", "resolveSession"])).toBe("resolveSession")
    })

    test("null when nothing matches", () => {
        expect(mentionedSymbol("unrelated prose", ["findUser"])).toBeNull()
    })
})

describe("touchesMigration", () => {
    test("a .sql file", () => {
        expect(touchesMigration([{ path: "supabase/migrations/0081_x.sql" }])).toBe(true)
    })

    test("a migrations directory in any language", () => {
        expect(touchesMigration([{ path: "app/migrations/0004_auto.py" }])).toBe(true)
    })

    test("prisma and rails schemas", () => {
        expect(touchesMigration([{ path: "prisma/schema.prisma" }])).toBe(true)
        expect(touchesMigration([{ path: "db/schema.rb" }])).toBe(true)
    })

    test("ordinary code is not a migration", () => {
        expect(touchesMigration([{ path: "lib/tasks-repo.ts" }])).toBe(false)
    })
})
