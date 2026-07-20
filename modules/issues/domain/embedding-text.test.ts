import { test, expect, describe } from "bun:test"
import { issueEmbeddingText, routingEmbeddingText } from "./embedding-text"

describe("issueEmbeddingText", () => {
    test("concatenates title and body, trimmed", () => {
        expect(issueEmbeddingText({ title: "  Login broken ", body: " users can't sign in " })).toBe(
            "Login broken\n\nusers can't sign in",
        )
    })
    test("caps at 7500 chars", () => {
        expect(issueEmbeddingText({ title: "t", body: "x".repeat(9000) }).length).toBe(7500)
    })
})

describe("routingEmbeddingText", () => {
    const proposal = (over: Record<string, unknown>) =>
        ({ title: "T", body: "B", routing_summary: null, layer: null, features: [], ...over }) as never

    test("falls back to title+body when no routing fields", () => {
        expect(routingEmbeddingText(proposal({}))).toBe("T\n\nB")
    })

    test("shapes summary + per-dimension tag lines mirroring the analyser's phrases", () => {
        const text = routingEmbeddingText(
            proposal({ routing_summary: "Auth service", layer: "backend", features: ["login", "oauth"] }),
        )
        expect(text).toContain("Auth service")
        expect(text).toContain("layer backend: Auth service")
        expect(text).toContain("feature login: Auth service")
        expect(text).toContain("feature oauth: Auth service")
    })
})
