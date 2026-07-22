import { test, expect, describe } from "bun:test"
import { AccessPolicy } from "./AccessPolicy"
import { Role } from "./Role"

const policy = new AccessPolicy()

describe("AccessPolicy.scopeForRole — role → project scope", () => {
    test("owner and admin see ALL team projects regardless of grants", () => {
        expect(policy.scopeForRole(Role.of("owner"), [])).toBe("all")
        expect(policy.scopeForRole(Role.of("admin"), ["p1"])).toBe("all")
    })
    test("a member sees the distinct set of granted project ids", () => {
        expect(policy.scopeForRole(Role.of("member"), ["p1", "p2", "p1"])).toEqual(["p1", "p2"])
    })
    test("a member with no grants sees nothing", () => {
        expect(policy.scopeForRole(Role.of("member"), [])).toEqual([])
    })
})

describe("AccessPolicy.allows — a scope permits a project", () => {
    test('"all" permits any project', () => {
        expect(policy.allows("all", "anything")).toBe(true)
    })
    test("an explicit list permits only its members", () => {
        expect(policy.allows(["p1", "p2"], "p2")).toBe(true)
        expect(policy.allows(["p1", "p2"], "p3")).toBe(false)
        expect(policy.allows([], "p1")).toBe(false)
    })
})
