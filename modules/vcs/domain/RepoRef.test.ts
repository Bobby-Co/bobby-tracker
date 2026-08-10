import { test, expect, describe } from "bun:test"
import { RepoRef, type RepoRefFields } from "./RepoRef"

const repoFullName = (f: RepoRefFields) => RepoRef.of(f).fullName()
const blobUrl = (f: RepoRefFields, file: string, line: number | undefined, sha: string | null) =>
    RepoRef.of(f).blobUrl(file, line, sha)

describe("RepoRef.fullName", () => {
    test("prefers the stored repo_full_name", () => {
        expect(repoFullName({ repo_full_name: "acme/app", repo_url: "https://github.com/other/x" })).toBe("acme/app")
    })
    test("falls back to parsing a URL (strips .git and trailing slash)", () => {
        expect(repoFullName({ repo_full_name: null, repo_url: "https://github.com/acme/app" })).toBe("acme/app")
        expect(repoFullName({ repo_full_name: null, repo_url: "https://www.github.com/acme/app.git" })).toBe("acme/app")
        expect(repoFullName({ repo_full_name: null, repo_url: "https://github.com/acme/app/" })).toBe("acme/app")
    })
    test("parses any host, including GitLab subgroups", () => {
        expect(repoFullName({ repo_full_name: null, repo_url: "https://gitlab.com/acme/app" })).toBe("acme/app")
        expect(repoFullName({ repo_full_name: null, repo_url: "https://git.acme.com/grp/sub/app" })).toBe("grp/sub/app")
    })
    test("null when the URL can't be parsed", () => {
        expect(repoFullName({ repo_full_name: null, repo_url: "" })).toBeNull()
    })
})

describe("RepoRef.blobUrl", () => {
    const gh: RepoRefFields = { repo_full_name: "acme/app", repo_url: "https://github.com/acme/app" }
    test("GitHub: pins to sha when given, HEAD otherwise; adds line fragment", () => {
        expect(blobUrl(gh, "src/x.ts", 12, "abc123")).toBe("https://github.com/acme/app/blob/abc123/src/x.ts#L12")
        expect(blobUrl(gh, "/src/x.ts", undefined, null)).toBe("https://github.com/acme/app/blob/HEAD/src/x.ts")
    })
    test("GitLab uses the /-/blob/ path (incl. self-managed hosts)", () => {
        expect(blobUrl({ repo_full_name: null, repo_url: "https://gitlab.com/a/b" }, "x", 1, null)).toBe(
            "https://gitlab.com/a/b/-/blob/HEAD/x#L1",
        )
        expect(blobUrl({ repo_full_name: null, repo_url: "https://git.acme.com/g/s/app" }, "src/y.ts", 3, "sha1")).toBe(
            "https://git.acme.com/g/s/app/-/blob/sha1/src/y.ts#L3",
        )
    })
    test("null when the URL can't be resolved", () => {
        expect(blobUrl({ repo_full_name: "acme/app", repo_url: "" }, "x", 1, null)).toBeNull()
    })
})
