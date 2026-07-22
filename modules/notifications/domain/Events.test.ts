import { test, expect, describe } from "bun:test"
import { NotificationPresenter } from "./Events"
import type { NotificationEvent } from "./Events"

const proj = { projectId: "p1", projectName: "Acme" }
const p = new NotificationPresenter()

describe("NotificationPresenter.render — feed snapshot per kind", () => {
    test("kb_ready / kb_updated link to the project", () => {
        expect(p.render({ ...proj, kind: "kb_ready" } as NotificationEvent)).toEqual({
            title: "Knowledge base is ready!",
            meta: "Acme",
            href: "/projects/p1",
        })
        expect(p.render({ ...proj, kind: "kb_updated" } as NotificationEvent).title).toBe(
            "Knowledge base update finished",
        )
    })

    test("pr_opened names the author and links to the PR", () => {
        const r = p.render({ ...proj, kind: "pr_opened", prNumber: 7, authorLogin: "octocat" } as NotificationEvent)
        expect(r.title).toBe("octocat opened a pull request")
        expect(r.meta).toBe("Acme · PR #7")
        expect(r.href).toBe("/projects/p1/pulls/7")
    })

    test("pr_opened falls back to 'Someone' with no author", () => {
        const r = p.render({ ...proj, kind: "pr_opened", prNumber: 7, authorLogin: null } as NotificationEvent)
        expect(r.title).toBe("Someone opened a pull request")
    })

    test("pr_analysis_ready shows the score when present, plain otherwise", () => {
        const scored = p.render({ ...proj, kind: "pr_analysis_ready", prNumber: 9, score: 8, scoreMax: 10 } as NotificationEvent)
        expect(scored.title).toBe("PR review ready — 8/10")
        const plain = p.render({ ...proj, kind: "pr_analysis_ready", prNumber: 9, score: null, scoreMax: null } as NotificationEvent)
        expect(plain.title).toBe("PR review ready")
    })
})

test("NotificationPresenter.defaultChannels — every kind fans out to in_app + email", () => {
    for (const kind of ["kb_ready", "kb_updated", "pr_opened", "pr_analysis_ready"] as const) {
        expect(p.defaultChannels(kind)).toEqual(["in_app", "email"])
    }
})
