// Tests for the consent CSRF token.
//
// The first test is the regression that motivated v2: the token MUST be stable
// for the same (secret, user, request). v1 derived it from the Supabase auth
// cookie VALUES, which rotate on token refresh — so the form minted one token and
// the POST verified a different one, and Approve silently bounced back to the
// consent screen. Anything that reintroduces per-request variance breaks the
// button in production while passing a naive "does it verify" test, so stability
// is asserted explicitly.

import { test, expect, describe } from "bun:test"
import { ConsentCsrf } from "./ConsentCsrf"

const SECRET = "server-secret-value"
const USER = "user-1"
const binding = ConsentCsrf.bindingFor({
    clientId: "client-a",
    redirectUri: "http://127.0.0.1:5599/callback",
    codeChallenge: "challenge-a",
})

describe("stability — the v1 regression", () => {
    test("the same inputs always mint the same token", async () => {
        const a = await ConsentCsrf.mint(SECRET, USER, binding)
        const b = await ConsentCsrf.mint(SECRET, USER, binding)
        expect(a).toBe(b)
        expect(a).not.toBe("")
    })

    test("a token minted now verifies later — nothing per-request leaks in", async () => {
        const minted = await ConsentCsrf.mint(SECRET, USER, binding)
        expect(await ConsentCsrf.verify(minted, SECRET, USER, binding)).toBe(true)
    })
})

describe("binding", () => {
    test("a token for one client does not approve another", async () => {
        const other = ConsentCsrf.bindingFor({
            clientId: "attacker-client",
            redirectUri: "http://127.0.0.1:5599/callback",
            codeChallenge: "challenge-a",
        })
        const minted = await ConsentCsrf.mint(SECRET, USER, binding)
        expect(await ConsentCsrf.verify(minted, SECRET, USER, other)).toBe(false)
    })

    test("a token for one redirect_uri does not approve another", async () => {
        const other = ConsentCsrf.bindingFor({
            clientId: "client-a",
            redirectUri: "http://evil.example/callback",
            codeChallenge: "challenge-a",
        })
        const minted = await ConsentCsrf.mint(SECRET, USER, binding)
        expect(await ConsentCsrf.verify(minted, SECRET, USER, other)).toBe(false)
    })

    test("one user's token does not work for another", async () => {
        const minted = await ConsentCsrf.mint(SECRET, USER, binding)
        expect(await ConsentCsrf.verify(minted, SECRET, "user-2", binding)).toBe(false)
    })

    test("fields cannot be shifted across the separator to forge the same tuple", async () => {
        // Without a separator the two tuples below would concatenate identically.
        const a = ConsentCsrf.bindingFor({ clientId: "ab", redirectUri: "c", codeChallenge: "d" })
        const b = ConsentCsrf.bindingFor({ clientId: "a", redirectUri: "bc", codeChallenge: "d" })
        expect(await ConsentCsrf.mint(SECRET, USER, a)).not.toBe(await ConsentCsrf.mint(SECRET, USER, b))
    })
})

describe("failure modes", () => {
    test("a different secret does not verify", async () => {
        const minted = await ConsentCsrf.mint(SECRET, USER, binding)
        expect(await ConsentCsrf.verify(minted, "other-secret", USER, binding)).toBe(false)
    })

    test("an unconfigured secret mints nothing and verifies nothing", async () => {
        expect(await ConsentCsrf.mint("", USER, binding)).toBe("")
        // Critically, an empty presented token must not pass against an empty secret.
        expect(await ConsentCsrf.verify("", "", USER, binding)).toBe(false)
    })

    test("an empty or garbage token is rejected", async () => {
        expect(await ConsentCsrf.verify("", SECRET, USER, binding)).toBe(false)
        expect(await ConsentCsrf.verify("not-a-token", SECRET, USER, binding)).toBe(false)
    })
})
