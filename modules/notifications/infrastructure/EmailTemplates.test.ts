import { test, expect, describe } from "bun:test"

import type { PrAnalysis, PullRequest } from "@/lib/shared/types"

import { renderNotificationEmail, type NotificationEmailContext } from "./EmailTemplates"

const base: NotificationEmailContext = {
    kind: "kb_ready",
    projectName: "Acme",
    url: "https://app.example.com/projects/p1",
}

const pull = {
    pr_number: 7,
    title: "Add the widget",
    body: "It adds the widget.",
    author_login: "ada",
    html_url: "https://github.com/acme/acme/pull/7",
    head_ref: "feat/widget",
    base_ref: "main",
    additions: 12,
    deletions: 3,
    changed_files: 2,
    comments_count: 0,
    draft: false,
    gh_created_at: "2026-08-19T09:12:00Z",
} as PullRequest

describe("every kind renders a complete document", () => {
    for (const kind of ["kb_ready", "kb_updated", "kb_failed", "pr_opened", "pr_analysis_ready"] as const) {
        test(kind, () => {
            const mail = renderNotificationEmail({ ...base, kind, prNumber: 7 })
            expect(mail.subject.length).toBeGreaterThan(0)
            expect(mail.html.startsWith("<!doctype html>")).toBe(true)
            expect(mail.html).toContain(base.url)
            // The text alternative is not optional — a mail without one is a
            // deliverability problem, not a cosmetic one.
            expect(mail.text).toContain(base.url)
            expect(mail.text).not.toContain("<")
        })
    }

    // A kind persisted by a newer build still has to produce a sendable mail.
    test("an unknown kind falls back to the feed row's own copy", () => {
        const mail = renderNotificationEmail({
            ...base,
            kind: "something_new" as NotificationEmailContext["kind"],
            fallbackTitle: "Something happened",
            fallbackMeta: "Acme · PR #7",
        })
        expect(mail.subject).toBe("Something happened · Acme")
        expect(mail.html).toContain("Something happened")
    })
})

describe("pr_analysis_ready", () => {
    const analysis = {
        summary: "It is mostly fine.",
        impact: "Touches the widget.",
        verdict: "request_changes",
        score: 6,
        score_max: 10,
        findings: [
            { file: "a.ts", line: 3, severity: "critical", category: "test_gap", title: "Boom", detail: "It explodes." },
            { file: "b.ts", severity: "review", title: "Hmm", detail: "Worth a look." },
        ],
        checklist: ["Run the widget tests."],
    } as PrAnalysis

    test("leads with the blocker count and carries the findings", () => {
        const mail = renderNotificationEmail({ ...base, kind: "pr_analysis_ready", prNumber: 7, analysis })
        expect(mail.subject).toContain("1 blocker to clear before merge")
        expect(mail.subject).toContain("6/10")
        expect(mail.html).toContain("Boom")
        expect(mail.html).toContain("a.ts:3")
        expect(mail.html).toContain("Run the widget tests.")
        // The analyser's snake_case topics are labels, not identifiers.
        expect(mail.html).toContain("test gap")
        expect(mail.html).not.toContain("test_gap")
    })

    test("an approving review says so instead of counting blockers", () => {
        const mail = renderNotificationEmail({
            ...base,
            kind: "pr_analysis_ready",
            prNumber: 7,
            analysis: { ...analysis, verdict: "approve", findings: analysis.findings?.slice(1) },
        })
        expect(mail.subject).toContain("nothing blocking")
    })

    // The score is optional and must never be invented to fill the layout out.
    test("no score means no score, not a zero", () => {
        const mail = renderNotificationEmail({
            ...base,
            kind: "pr_analysis_ready",
            prNumber: 7,
            analysis: { ...analysis, score: undefined, score_max: undefined },
        })
        expect(mail.subject).not.toContain("/")
        expect(mail.html).not.toContain("Merge readiness")
    })

    // What the outbox channel can render before it can reach the stored result.
    test("degrades to the score headline with no analysis at all", () => {
        const mail = renderNotificationEmail({ ...base, kind: "pr_analysis_ready", prNumber: 7, score: 9, scoreMax: 10 })
        expect(mail.subject).toContain("9/10")
        expect(mail.html).toContain("Merge readiness")
    })
})

describe("kb_failed", () => {
    test("carries the analyser's own error, verbatim", () => {
        const mail = renderNotificationEmail({ ...base, kind: "kb_failed", reason: "clone failed: remote returned 403" })
        expect(mail.subject).toBe("Indexing failed for Acme")
        expect(mail.html).toContain("remote returned 403")
        expect(mail.text).toContain("remote returned 403")
    })

    // A failure with no recorded reason still has to say what to do next.
    test("degrades with no reason recorded", () => {
        const mail = renderNotificationEmail({ ...base, kind: "kb_failed", reason: null })
        expect(mail.html).not.toContain("What the analyser reported")
        expect(mail.html).toContain("Worth checking")
    })
})

describe("pr_opened", () => {
    test("names the author and carries the diff", () => {
        const mail = renderNotificationEmail({ ...base, kind: "pr_opened", prNumber: 7, pull })
        expect(mail.subject).toContain("ada opened PR #7")
        expect(mail.html).toContain("Add the widget")
        expect(mail.html).toContain("+12")
        expect(mail.html).toContain("feat/widget")
        expect(mail.html).toContain(pull.html_url as string)
    })

    test("degrades to the number alone with no mirror row", () => {
        const mail = renderNotificationEmail({ ...base, kind: "pr_opened", prNumber: 7 })
        expect(mail.subject).toContain("PR #7 was opened")
        expect(mail.html).toContain(base.url)
    })
})

// Repo names, PR titles and model-written review prose all reach the template
// unescaped; none of them is trusted markup.
test("caller-supplied strings are escaped", () => {
    const mail = renderNotificationEmail({
        ...base,
        kind: "pr_opened",
        prNumber: 7,
        projectName: "<script>alert(1)</script>",
        pull: { ...pull, title: "<img onerror=x>" } as PullRequest,
    })
    expect(mail.html).not.toContain("<script>")
    expect(mail.html).not.toContain("<img onerror")
    expect(mail.html).toContain("&lt;script&gt;")
})
