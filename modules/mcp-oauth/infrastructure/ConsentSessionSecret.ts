// Reads the browser-session material the consent screen's CSRF token is derived
// from (see domain/ConsentCsrf for the full rationale).
//
// The material is the caller's Supabase auth cookies. The property that matters
// is NOT that they are unpredictable in general — it is that a cross-site page
// can cause the browser to SEND them but can never READ them, so an attacker
// cannot compute a token bound to them. Only cookie NAME=VALUE pairs are hashed;
// nothing derived from them is ever returned to the browser.
//
// Sorted by name because Supabase chunks a large session across `…auth-token.0`,
// `.1`, … and header order is not guaranteed stable between requests.

import { cookies } from "next/headers"

const SUPABASE_COOKIE_PREFIX = "sb-"

export class ConsentSessionSecret {
    /** The current request's session material, or "" when the caller has no
     *  Supabase cookies at all (in which case there is no session to protect and
     *  the consent page will have redirected to /login already). */
    static async read(): Promise<string> {
        const jar = await cookies()
        return jar
            .getAll()
            .filter((c) => c.name.startsWith(SUPABASE_COOKIE_PREFIX))
            .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
            .map((c) => `${c.name}=${c.value}`)
            .join("&")
    }
}
