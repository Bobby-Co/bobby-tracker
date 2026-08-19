// BetaEmail — the normalisation the whole gate rests on. A row stored one way and
// looked up another is an invitation that can never be redeemed, so these cases
// are the contract, not incidental behaviour.

import { test, expect, describe } from "bun:test"
import { BetaEmail } from "./BetaEmail"

describe("BetaEmail.of", () => {
    test("lower-cases and trims — providers report addresses however they like", () => {
        expect(BetaEmail.of("  Ada@Example.COM ")?.value).toBe("ada@example.com")
    })

    test("rejects anything that isn't an address", () => {
        for (const bad of [null, undefined, "", "   ", "ada", "ada@", "@example.com", "ada@example", "a b@c.com"]) {
            expect(BetaEmail.of(bad)).toBeNull()
        }
    })

    test("accepts the shapes real accounts use", () => {
        for (const good of ["ada+beta@example.co.uk", "a.b-c_d@sub.example.io"]) {
            expect(BetaEmail.of(good)?.value).toBe(good)
        }
    })
})
