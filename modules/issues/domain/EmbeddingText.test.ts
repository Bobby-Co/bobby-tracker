import { test, expect, describe } from "bun:test"
import { EmbeddingText } from "./EmbeddingText"

const text = new EmbeddingText()

describe("EmbeddingText.forIssue", () => {
    test("concatenates title and body, trimmed", () => {
        expect(text.forIssue({ title: "  Login broken ", body: " users can't sign in " })).toBe(
            "Login broken\n\nusers can't sign in",
        )
    })
    test("caps at 7500 chars", () => {
        expect(text.forIssue({ title: "t", body: "x".repeat(9000) }).length).toBe(7500)
    })
})

describe("EmbeddingText.forRouting", () => {
    const proposal = (over: Record<string, unknown>) =>
        ({ title: "T", body: "B", routing_summary: null, layer: null, features: [], ...over }) as never

    test("falls back to title+body when no routing fields", () => {
        expect(text.forRouting(proposal({}))).toBe("T\n\nB")
    })

    test("shapes summary + per-dimension tag lines mirroring the analyser's phrases", () => {
        const out = text.forRouting(
            proposal({ routing_summary: "Auth service", layer: "backend", features: ["login", "oauth"] }),
        )
        expect(out).toContain("Auth service")
        expect(out).toContain("layer backend: Auth service")
        expect(out).toContain("feature login: Auth service")
        expect(out).toContain("feature oauth: Auth service")
    })
})
