// DI test for the TeamMemberViews use-case — inject a mock UserDirectory and pin
// the merge: profiles enrich rows, order is preserved, and a missing/unresolved
// profile folds to null fields (a removed account still shows a row).

import { test, expect, describe, mock } from "bun:test"
import { TeamMemberViews } from "./TeamMemberViews"
import type { UserProfile } from "../ports/UserDirectory"

const directory = { resolveProfiles: mock() }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const svc = () => new TeamMemberViews(directory as any)

const profile = (over: Partial<UserProfile>): UserProfile => ({
    user_id: over.user_id ?? "u",
    email: over.email ?? null,
    name: over.name ?? null,
    avatar_url: over.avatar_url ?? null,
})

describe("TeamMemberViews.build", () => {
    test("enriches rows with profiles, preserving input order", async () => {
        directory.resolveProfiles.mockResolvedValue(
            new Map([
                ["u1", profile({ user_id: "u1", email: "a@x.com", name: "Ada", avatar_url: "img" })],
                ["u2", profile({ user_id: "u2", email: "b@x.com", name: "Bob" })],
            ]),
        )
        const out = await svc().build([
            { user_id: "u1", role: "owner", created_at: "t1" },
            { user_id: "u2", role: "member", created_at: "t2" },
        ])
        expect(out).toEqual([
            { user_id: "u1", role: "owner", email: "a@x.com", name: "Ada", avatar_url: "img", created_at: "t1" },
            { user_id: "u2", role: "member", email: "b@x.com", name: "Bob", avatar_url: null, created_at: "t2" },
        ])
    })

    test("a row with no resolved profile folds to null fields", async () => {
        directory.resolveProfiles.mockResolvedValue(new Map())
        const out = await svc().build([{ user_id: "gone", role: "admin", created_at: "t" }])
        expect(out).toEqual([
            { user_id: "gone", role: "admin", email: null, name: null, avatar_url: null, created_at: "t" },
        ])
    })

    test("empty input → empty output, still queries the directory", async () => {
        directory.resolveProfiles.mockResolvedValue(new Map())
        expect(await svc().build([])).toEqual([])
    })
})
