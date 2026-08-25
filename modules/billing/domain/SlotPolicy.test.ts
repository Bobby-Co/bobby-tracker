// The free-team quota. Every case here is either "we gave away a free allowance
// we shouldn't have" or "we blocked something the user is entitled to", so the
// table is exhaustive rather than representative.

import { test, expect, describe } from "bun:test"
import { SlotPolicy, type SubjectFacts } from "./SlotPolicy"

const subject = (over: Partial<SubjectFacts> & Pick<SubjectFacts, "slot">): SubjectFacts => ({
    id: over.id ?? `s-${over.slot}`,
    slot: over.slot,
    status: over.status ?? "active",
    boundTeamId: over.boundTeamId === undefined ? "t1" : over.boundTeamId,
})

const policy = new SlotPolicy()

describe("allocate — a brand-new email", () => {
    test("first team takes the personal slot, creating its subject", () => {
        expect(policy.allocate([])).toEqual({ allowed: true, slot: "personal", subjectId: null })
    })

    test("second team takes the free slot", () => {
        const out = policy.allocate([subject({ slot: "personal" })])
        expect(out).toEqual({ allowed: true, slot: "free", subjectId: null })
    })

    test("third team needs a plan", () => {
        const out = policy.allocate([subject({ slot: "personal" }), subject({ slot: "free", id: "s-free" })])
        expect(out).toEqual({ allowed: false, reason: "needs_paid_plan" })
    })

    test("paid teams don't consume a reserved slot", () => {
        const out = policy.allocate([
            subject({ slot: "personal" }),
            subject({ slot: "paid", id: "s-paid-1" }),
            subject({ slot: "paid", id: "s-paid-2" }),
        ])
        expect(out).toEqual({ allowed: true, slot: "free", subjectId: null })
    })
})

describe("allocate — the anti-reset behaviour", () => {
    test("a DELETED free team's subject is reused, so its balance follows the "
        + "replacement instead of resetting", () => {
        const vacant = subject({ slot: "free", id: "s-free", boundTeamId: null })
        const out = policy.allocate([subject({ slot: "personal" }), vacant])
        expect(out).toEqual({ allowed: true, slot: "free", subjectId: "s-free" })
    })

    test("a deleted PERSONAL team likewise rebinds to its own subject", () => {
        const out = policy.allocate([subject({ slot: "personal", id: "s-p", boundTeamId: null })])
        expect(out).toEqual({ allowed: true, slot: "personal", subjectId: "s-p" })
    })

    test("a SUSPENDED team frees its slot — that is what the pause button is for", () => {
        const paused = subject({ slot: "free", id: "s-free", status: "suspended" })
        const out = policy.allocate([subject({ slot: "personal" }), paused])
        expect(out).toEqual({ allowed: true, slot: "free", subjectId: "s-free" })
    })
})

describe("onPlanEnd", () => {
    test("free slot never used → downgrade, and a subject gets created", () => {
        const paid = subject({ slot: "paid", id: "s-paid" })
        expect(policy.onPlanEnd([subject({ slot: "personal" }), paid], "s-paid")).toEqual({
            action: "downgrade_to_free",
            subjectId: null,
        })
    })

    test("free slot vacant (team deleted) → downgrade onto that subject", () => {
        const paid = subject({ slot: "paid", id: "s-paid" })
        const vacant = subject({ slot: "free", id: "s-free", boundTeamId: null })
        expect(policy.onPlanEnd([vacant, paid], "s-paid")).toEqual({
            action: "downgrade_to_free",
            subjectId: "s-free",
        })
    })

    test("free slot taken by a running team → suspend, data kept", () => {
        const paid = subject({ slot: "paid", id: "s-paid" })
        const held = subject({ slot: "free", id: "s-free" })
        expect(policy.onPlanEnd([held, paid], "s-paid")).toEqual({ action: "suspend" })
    })

    test("free slot held by a SUSPENDED team → downgrade; pausing that team is "
        + "exactly how the owner makes room", () => {
        const paid = subject({ slot: "paid", id: "s-paid" })
        const paused = subject({ slot: "free", id: "s-free", status: "suspended" })
        expect(policy.onPlanEnd([paused, paid], "s-paid")).toEqual({
            action: "downgrade_to_free",
            subjectId: "s-free",
        })
    })

    test("the ending subject never counts as occupying the slot it is falling into", () => {
        const paid = subject({ slot: "paid", id: "s-paid" })
        expect(policy.onPlanEnd([paid], "s-paid")).toEqual({ action: "downgrade_to_free", subjectId: null })
    })
})

describe("canResume", () => {
    test("a paid subject always resumes — the plan pays for the slot", () => {
        const paid = subject({ slot: "paid", id: "s-paid", status: "suspended" })
        expect(policy.canResume([subject({ slot: "free", id: "s-free" }), paid], "s-paid")).toBe(true)
    })

    test("a free subject resumes only when nothing else holds the slot", () => {
        const paused = subject({ slot: "free", id: "s-free", status: "suspended" })
        expect(policy.canResume([paused], "s-free")).toBe(true)
    })

    test("two subjects can't hold the same reserved slot at once", () => {
        // Only reachable when a paid team was downgraded INTO the free slot while
        // the original free team sat paused — resuming it would mean two free
        // teams, which is the reset this whole model prevents.
        const paused = subject({ slot: "free", id: "s-free", status: "suspended" })
        const downgraded = subject({ slot: "free", id: "s-was-paid" })
        expect(policy.canResume([paused, downgraded], "s-free")).toBe(false)
    })

    test("an unknown subject never resumes", () => {
        expect(policy.canResume([], "nope")).toBe(false)
    })
})

describe("freeTeamsInUse", () => {
    test("counts running reserved teams only", () => {
        const subjects = [
            subject({ slot: "personal" }),
            subject({ slot: "free", id: "s-free", status: "suspended" }),
            subject({ slot: "paid", id: "s-paid" }),
        ]
        expect(policy.freeTeamsInUse(subjects)).toBe(1)
    })
})
