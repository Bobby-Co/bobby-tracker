import { test, expect, describe } from "bun:test"
import { issueRefHref, parseIssueRef, issueRefMarkdown } from "./IssueRef"

describe("issueRefHref / parseIssueRef", () => {
    test("round-trips project + issue ids", () => {
        const href = issueRefHref("proj-123", "issue-abc")
        expect(href).toBe("issue:proj-123:issue-abc")
        expect(parseIssueRef(href)).toEqual({ projectId: "proj-123", issueId: "issue-abc" })
    })

    test("handles uuid-shaped ids", () => {
        const href = issueRefHref("7f1c2e4a-0000-4aaa-bbbb-cccccccccccc", "9a8b7c6d-1111-2222-3333-444444444444")
        expect(parseIssueRef(href)).toEqual({
            projectId: "7f1c2e4a-0000-4aaa-bbbb-cccccccccccc",
            issueId: "9a8b7c6d-1111-2222-3333-444444444444",
        })
    })

    test("returns null for ordinary links", () => {
        expect(parseIssueRef("https://example.com")).toBeNull()
        expect(parseIssueRef("/projects/x/issues/y")).toBeNull()
        expect(parseIssueRef(null)).toBeNull()
        expect(parseIssueRef("issue:onlyone")).toBeNull()
    })
})

describe("issueRefMarkdown", () => {
    test("builds a labelled link", () => {
        expect(issueRefMarkdown("p", "i", 42, "Login button loops")).toBe(
            "[#42 Login button loops](issue:p:i)",
        )
    })

    test("strips brackets that would end the label early", () => {
        expect(issueRefMarkdown("p", "i", 7, "Crash in [modal] view")).toBe("[#7 Crash in modal view](issue:p:i)")
    })

    test("falls back to just the number when the title is empty", () => {
        expect(issueRefMarkdown("p", "i", 9, "   ")).toBe("[#9](issue:p:i)")
    })

    test("the markdown it emits parses back to the same ids", () => {
        const md = issueRefMarkdown("proj", "iss", 3, "Anything")
        const href = md.slice(md.indexOf("](") + 2, md.length - 1)
        expect(parseIssueRef(href)).toEqual({ projectId: "proj", issueId: "iss" })
    })
})
