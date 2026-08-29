// The frozen interop cases. These are Zoo's, deliberately duplicated rather
// than referenced: the whole point is that two independent implementations
// agree, and a shared fixture would hide a drift in either one.

import { test, expect, describe } from "bun:test"
import { normalizeRepoUrl } from "./RepoKey"

describe("normalizeRepoUrl — every shape of one repo collapses to one key", () => {
    const github = "github.com/acme/widgets"
    for (const raw of [
        "git@github.com:acme/widgets.git",
        "https://github.com/Acme/Widgets",
        "ssh://git@github.com:22/acme/widgets.git",
        "https://x-token:abc@github.com/acme/widgets.git",
        "https://github.com/acme/widgets/",
        "github.com/acme/widgets",
    ]) {
        test(raw, () => expect(normalizeRepoUrl(raw)).toBe(github))
    }
})

describe("normalizeRepoUrl — Zoo's frozen cases", () => {
    const cases: [string, string][] = [
        ["git@gitlab.com:group/sub/project.git", "gitlab.com/group/sub/project"],
        ["https://gitlab.com/group/sub/project.git", "gitlab.com/group/sub/project"],
        ["ssh://git@git.internal:2222/team/app.git", "git.internal:2222/team/app"],
        ["https://git.internal:8443/team/app.git", "git.internal:8443/team/app"],
    ]
    for (const [raw, expected] of cases) {
        test(raw, () => expect(normalizeRepoUrl(raw)).toBe(expected))
    }
})

describe("normalizeRepoUrl — not a usable remote", () => {
    test("empty / null", () => {
        expect(normalizeRepoUrl("")).toBeNull()
        expect(normalizeRepoUrl(null)).toBeNull()
        expect(normalizeRepoUrl(undefined)).toBeNull()
    })
    test("a bare host has no repo path", () => {
        expect(normalizeRepoUrl("github.com")).toBeNull()
    })
})
