import { test, expect, describe } from "bun:test"
import { Role } from "./Role"

describe("Role.atLeast — the owner > admin > member ordering", () => {
    test("owner clears every threshold", () => {
        expect(Role.of("owner").atLeast("owner")).toBe(true)
        expect(Role.of("owner").atLeast("admin")).toBe(true)
        expect(Role.of("owner").atLeast("member")).toBe(true)
    })
    test("admin clears admin and member, not owner", () => {
        expect(Role.of("admin").atLeast("owner")).toBe(false)
        expect(Role.of("admin").atLeast("admin")).toBe(true)
        expect(Role.of("admin").atLeast("member")).toBe(true)
    })
    test("member clears only member", () => {
        expect(Role.of("member").atLeast("owner")).toBe(false)
        expect(Role.of("member").atLeast("admin")).toBe(false)
        expect(Role.of("member").atLeast("member")).toBe(true)
    })
})

describe("Role — a non-member fails closed", () => {
    test("null / undefined is never at least anything", () => {
        expect(Role.of(null).atLeast("member")).toBe(false)
        expect(Role.of(undefined).atLeast("member")).toBe(false)
        expect(Role.of(null).atLeast("owner")).toBe(false)
    })
    test("value reflects the wrapped role (null when absent)", () => {
        expect(Role.of("admin").value).toBe("admin")
        expect(Role.of(null).value).toBeNull()
        expect(Role.of(undefined).value).toBeNull()
    })
})
