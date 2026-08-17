import { test, expect, describe } from "bun:test"
import { RepoRef, type RepoRefFields } from "./RepoRef"

const repoFullName = (f: RepoRefFields) => RepoRef.of(f).fullName()
const blobUrl = (f: RepoRefFields, file: string, line: number | undefined, sha: string | null) =>
    RepoRef.of(f).blobUrl(file, line, sha)

describe("RepoRef.fullName", () => {
    test("prefers the stored repo_full_name", () => {
        expect(repoFullName({ repo_full_name: "acme/app", repo_url: "https://github.com/other/x" })).toBe("acme/app")
    })
    test("falls back to parsing a github URL (strips .git and trailing slash)", () => {
        expect(repoFullName({ repo_full_name: null, repo_url: "https://github.com/acme/app" })).toBe("acme/app")
        expect(repoFullName({ repo_full_name: null, repo_url: "https://www.github.com/acme/app.git" })).toBe("acme/app")
        expect(repoFullName({ repo_full_name: null, repo_url: "https://github.com/acme/app/" })).toBe("acme/app")
    })
    test("returns null for non-github hosts", () => {
        expect(repoFullName({ repo_full_name: null, repo_url: "https://gitlab.com/acme/app" })).toBeNull()
    })
})

describe("RepoRef.blobUrl", () => {
    const p: RepoRefFields = { repo_full_name: "acme/app", repo_url: "" }
    test("pins to sha when given, HEAD otherwise; adds line fragment", () => {
        expect(blobUrl(p, "src/x.ts", 12, "abc123")).toBe("https://github.com/acme/app/blob/abc123/src/x.ts#L12")
        expect(blobUrl(p, "/src/x.ts", undefined, null)).toBe("https://github.com/acme/app/blob/HEAD/src/x.ts")
    })
    test("null when the project isn't on github", () => {
        expect(blobUrl({ repo_full_name: null, repo_url: "https://gitlab.com/a/b" }, "x", 1, null)).toBeNull()
    })
})
