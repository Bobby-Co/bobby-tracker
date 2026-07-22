// DI characterization tests for the AccessService — the app-layer authz logic.
// The service takes its two repositories by CONSTRUCTOR, so we inject plain mocks
// (no mock.module needed) and pin the branching that used to live in
// lib/auth/team-access.ts: active-team resolution + bootstrap, the role → project
// scope rule, and the single-project gate.

import { test, expect, describe, mock, beforeEach } from "bun:test"
import { AccessService } from "./AccessService"

const projects = { findTeamId: mock() }
const teams = {
    listUserTeams: mock(),
    ensurePersonalTeam: mock(),
    findTeamRole: mock(),
    listUserGroupIds: mock(),
    listProjectIdsForGroups: mock(),
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const svc = () => new AccessService(projects as any, teams as any)

const team = (id: string, over: Partial<{ is_personal: boolean; name: string; role: string }> = {}) => ({
    id,
    name: over.name ?? id,
    is_personal: over.is_personal ?? false,
    role: over.role ?? "member",
    created_by: null,
    created_at: "",
    updated_at: "",
})

beforeEach(() => {
    projects.findTeamId.mockReset().mockResolvedValue(null)
    teams.listUserTeams.mockReset().mockResolvedValue([])
    teams.ensurePersonalTeam.mockReset().mockResolvedValue(undefined)
    teams.findTeamRole.mockReset().mockResolvedValue(null)
    teams.listUserGroupIds.mockReset().mockResolvedValue([])
    teams.listProjectIdsForGroups.mockReset().mockResolvedValue([])
})

describe("listTeams — bootstraps a personal team on first use", () => {
    test("returns existing teams without bootstrapping", async () => {
        teams.listUserTeams.mockResolvedValue([team("t1", { is_personal: true })])
        expect(await svc().listTeams("u1")).toHaveLength(1)
        expect(teams.ensurePersonalTeam).not.toHaveBeenCalled()
    })
    test("empty → ensure_personal_team, then re-read", async () => {
        teams.listUserTeams.mockResolvedValueOnce([]).mockResolvedValueOnce([team("t1", { is_personal: true })])
        const out = await svc().listTeams("u1", "Ada's Personal Team")
        expect(teams.ensurePersonalTeam).toHaveBeenCalledWith("u1", "Ada's Personal Team")
        expect(out).toHaveLength(1)
    })
})

describe("resolveActiveTeam", () => {
    test("honours a requested team the caller belongs to", async () => {
        teams.listUserTeams.mockResolvedValue([team("t1", { is_personal: true }), team("t2")])
        expect((await svc().resolveActiveTeam("u1", "t2"))?.id).toBe("t2")
    })
    test("ignores a stale/unknown requested id → personal team", async () => {
        teams.listUserTeams.mockResolvedValue([team("t1", { is_personal: true }), team("t2")])
        expect((await svc().resolveActiveTeam("u1", "nope"))?.id).toBe("t1")
    })
    test("no requested id → personal, then first", async () => {
        teams.listUserTeams.mockResolvedValue([team("t2"), team("t1", { is_personal: true })])
        expect((await svc().resolveActiveTeam("u1", null))?.id).toBe("t1")
        teams.listUserTeams.mockResolvedValue([team("t2"), team("t3")])
        expect((await svc().resolveActiveTeam("u1", null))?.id).toBe("t2")
    })
    test("no team even after bootstrap → null", async () => {
        teams.listUserTeams.mockResolvedValue([])
        expect(await svc().resolveActiveTeam("u1", null)).toBeNull()
    })
})

describe("accessibleProjectIds — role → project scope", () => {
    test('owner/admin ⇒ "all" and never reads the group tables', async () => {
        expect(await svc().accessibleProjectIds("t1", "u1", "admin")).toBe("all")
        expect(await svc().accessibleProjectIds("t1", "u1", "owner")).toBe("all")
        expect(teams.listUserGroupIds).not.toHaveBeenCalled()
    })
    test("member with grants ⇒ distinct granted project ids", async () => {
        teams.listUserGroupIds.mockResolvedValue(["g1", "g2"])
        teams.listProjectIdsForGroups.mockResolvedValue(["p1", "p2", "p1"])
        expect(await svc().accessibleProjectIds("t1", "u1", "member")).toEqual(["p1", "p2"])
    })
    test("member with no groups ⇒ [] (short-circuits the project read)", async () => {
        teams.listUserGroupIds.mockResolvedValue([])
        expect(await svc().accessibleProjectIds("t1", "u1", "member")).toEqual([])
        expect(teams.listProjectIdsForGroups).not.toHaveBeenCalled()
    })
})

describe("canAccessProject — the single-project gate", () => {
    test("unknown/invisible project ⇒ not ok, no role", async () => {
        projects.findTeamId.mockResolvedValue(null)
        expect(await svc().canAccessProject("u1", "p1")).toEqual({ ok: false, teamId: null, role: null })
    })
    test("not a team member ⇒ not ok, team known", async () => {
        projects.findTeamId.mockResolvedValue("t1")
        teams.findTeamRole.mockResolvedValue(null)
        expect(await svc().canAccessProject("u1", "p1")).toEqual({ ok: false, teamId: "t1", role: null })
    })
    test("admin ⇒ ok for any project in the team", async () => {
        projects.findTeamId.mockResolvedValue("t1")
        teams.findTeamRole.mockResolvedValue("admin")
        expect(await svc().canAccessProject("u1", "p1")).toEqual({ ok: true, teamId: "t1", role: "admin" })
    })
    test("member granted the project ⇒ ok", async () => {
        projects.findTeamId.mockResolvedValue("t1")
        teams.findTeamRole.mockResolvedValue("member")
        teams.listUserGroupIds.mockResolvedValue(["g1"])
        teams.listProjectIdsForGroups.mockResolvedValue(["p1"])
        expect(await svc().canAccessProject("u1", "p1")).toEqual({ ok: true, teamId: "t1", role: "member" })
    })
    test("member NOT granted the project ⇒ not ok (but role/team still reported)", async () => {
        projects.findTeamId.mockResolvedValue("t1")
        teams.findTeamRole.mockResolvedValue("member")
        teams.listUserGroupIds.mockResolvedValue(["g1"])
        teams.listProjectIdsForGroups.mockResolvedValue(["p9"])
        expect(await svc().canAccessProject("u1", "p1")).toEqual({ ok: false, teamId: "t1", role: "member" })
    })
})
