// The account-deletion decision table. Exhaustive on purpose: every branch here
// either destroys data or refuses to, and it is the one part of the flow that can
// be tested without deleting anything.

import { test, expect, describe } from "bun:test"
import { AccountDeletionPlanner, type TeamFacts } from "./AccountDeletionPlan"
import type { TeamRoleValue } from "@/modules/access"

const team = (over: Partial<TeamFacts> = {}): TeamFacts => ({
    id: over.id ?? "t1",
    name: over.name ?? "Team",
    isPersonal: over.isPersonal ?? false,
    myRole: (over.myRole ?? "owner") as TeamRoleValue,
    ownerCount: over.ownerCount ?? 1,
    memberCount: over.memberCount ?? 1,
})

const planner = new AccountDeletionPlanner()

describe("disposition", () => {
    test("the personal team always goes with the account", () => {
        const plan = planner.plan([team({ isPersonal: true })])
        expect(plan.toDelete).toHaveLength(1)
    })

    test("sole owner, alone → deleted (nobody else can reach it)", () => {
        const plan = planner.plan([team({ myRole: "owner", ownerCount: 1, memberCount: 1 })])
        expect(plan.toDelete).toHaveLength(1)
        expect(plan.blocked).toHaveLength(0)
    })

    test("sole owner WITH members → blocked, never silently deleted", () => {
        const plan = planner.plan([team({ myRole: "owner", ownerCount: 1, memberCount: 4 })])
        expect(plan.blocked).toHaveLength(1)
        expect(plan.toDelete).toHaveLength(0)
        expect(planner.canProceed(plan)).toBe(false)
    })

    test("co-owned → just left, however many members", () => {
        const plan = planner.plan([team({ myRole: "owner", ownerCount: 2, memberCount: 9 })])
        expect(plan.toLeave).toHaveLength(1)
    })

    test("admin or member → just left", () => {
        for (const role of ["admin", "member"] as TeamRoleValue[]) {
            const plan = planner.plan([team({ myRole: role, ownerCount: 1, memberCount: 3 })])
            expect(plan.toLeave).toHaveLength(1)
            expect(plan.blocked).toHaveLength(0)
        }
    })

    test("an admin of a team whose owner already left is NOT blocked — they are "
        + "not the owner, so it is not theirs to decide", () => {
        const plan = planner.plan([team({ myRole: "admin", ownerCount: 0, memberCount: 2 })])
        expect(plan.toLeave).toHaveLength(1)
    })
})

describe("plan", () => {
    test("partitions totally — every team lands in exactly one bucket", () => {
        const teams = [
            team({ id: "personal", isPersonal: true }),
            team({ id: "solo" }),
            team({ id: "shared", memberCount: 3 }),
            team({ id: "co-owned", ownerCount: 2, memberCount: 2 }),
            team({ id: "guest", myRole: "member", memberCount: 5 }),
        ]
        const plan = planner.plan(teams)
        const total = plan.blocked.length + plan.toDelete.length + plan.toLeave.length
        expect(total).toBe(teams.length)
        expect(plan.blocked.map((t) => t.id)).toEqual(["shared"])
        expect(plan.toDelete.map((t) => t.id)).toEqual(["personal", "solo"])
        expect(plan.toLeave.map((t) => t.id)).toEqual(["co-owned", "guest"])
    })

    test("no teams at all → nothing to do, and proceeding is allowed", () => {
        const plan = planner.plan([])
        expect(planner.canProceed(plan)).toBe(true)
    })

    test("one blocking team blocks the WHOLE deletion, not just that team", () => {
        const plan = planner.plan([team({ id: "solo" }), team({ id: "shared", memberCount: 2 })])
        expect(planner.canProceed(plan)).toBe(false)
    })
})
