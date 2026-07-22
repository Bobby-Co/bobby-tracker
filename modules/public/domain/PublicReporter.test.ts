import { test, expect, describe } from "bun:test"
import { PublicReporter } from "./PublicReporter"
import type { PublicListedIssue } from "./PublicReporter"

const reporter = new PublicReporter()

describe("PublicReporter.display", () => {
    test("named submitter shows their name", () => {
        expect(reporter.display("id-123456789", "Dana")).toBe("Dana")
    })
    test("anonymous-with-id shows a short stable handle", () => {
        expect(reporter.display("abcdef-ghijkl", null)).toBe("Anonymous · abcdef")
    })
    test("pre-migration row (no id, no name) is generic Anonymous", () => {
        expect(reporter.display(null, null)).toBe("Anonymous")
    })
})

const issue = (over: Partial<PublicListedIssue>): PublicListedIssue => ({
    id: "x",
    issue_number: 1,
    title: "t",
    status: "open",
    project_name: "P",
    public_reporter_id: "r1",
    public_reporter_name: "Dana",
    duplicate_of_issue_id: null,
    created_at: "2026-07-01T00:00:00Z",
    ...over,
})

describe("PublicReporter.groupByParent", () => {
    test("nests duplicates under their parent; parents newest-first, children oldest-first", () => {
        const parent = issue({ id: "p", created_at: "2026-07-10T00:00:00Z" })
        const c1 = issue({ id: "c1", duplicate_of_issue_id: "p", created_at: "2026-07-05T00:00:00Z" })
        const c2 = issue({ id: "c2", duplicate_of_issue_id: "p", created_at: "2026-07-08T00:00:00Z" })
        const rows = reporter.groupByParent([parent, c2, c1])
        expect(rows).toHaveLength(1)
        expect(rows[0].parent.id).toBe("p")
        expect(rows[0].children.map((c) => c.id)).toEqual(["c1", "c2"]) // ascending by created_at
    })

    test("orphan duplicate (parent not visible) surfaces as its own top-level row", () => {
        const orphan = issue({ id: "o", duplicate_of_issue_id: "missing" })
        const rows = reporter.groupByParent([orphan])
        expect(rows).toHaveLength(1)
        expect(rows[0].parent.id).toBe("o")
    })
})

describe("PublicReporter.groupParentsByReporter", () => {
    test("buckets threads by the parent's reporter", () => {
        const a = reporter.groupByParent([issue({ id: "a", public_reporter_id: "r1", public_reporter_name: "Ann" })])
        const b = reporter.groupByParent([issue({ id: "b", public_reporter_id: "r2", public_reporter_name: "Bo" })])
        const groups = reporter.groupParentsByReporter([...a, ...b])
        expect(groups.map((g) => g.reporter_id).sort()).toEqual(["r1", "r2"])
    })
})
