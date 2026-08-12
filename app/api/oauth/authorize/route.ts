import { Supabase } from "@/lib/server/supabase"
import {
    AuthorizationRequest,
    ConsentCsrf,
    ConsentSessionSecret,
    OAuthServerConfig,
    getOAuthAuthorizationService,
    type AuthorizeQuery,
} from "@/modules/mcp-oauth"

// POST /api/oauth/authorize — the consent DECISION (Approve / Deny) submitted by
// the form on /oauth/consent.
//
// This is the one endpoint in the OAuth surface that IS cookie-authenticated: it
// acts as the signed-in user. That makes it a CSRF target, and specifically a
// valuable one — every client here is public and holds its own PKCE verifier, so
// an attacker who can make a victim's browser approve the ATTACKER's registered
// client receives a usable code at their own redirect_uri. Silent account
// takeover of the MCP surface, no phishing required.
//
// THREE INDEPENDENT DEFENCES, each sufficient to break that attack alone:
//
//   1. ORIGIN. The request must carry a same-origin `Origin` (or, failing that,
//      `Referer`). A cross-site form POST always carries the attacker's origin,
//      and neither header can be forged by page script.
//   2. SESSION-BOUND TOKEN. `csrf` is a hash over the caller's own Supabase
//      cookies + user id + this request's client/redirect/PKCE tuple. A
//      cross-site page can make the browser SEND those cookies but can never READ
//      them, so it cannot compute the token — and the tuple binding stops a token
//      minted for a benign client being replayed to approve a different one.
//   3. RE-VALIDATION. Every parameter is re-checked against the registered client
//      from scratch. The hidden fields travelled through the browser, so they are
//      untrusted input; a tampered redirect_uri is rejected here even though the
//      GET that rendered them was clean.
//
// No CORS headers: same-origin only, deliberately.

export async function POST(request: Request) {
    // ── defence 1: same-origin ───────────────────────────────────────────────
    if (!isSameOrigin(request)) {
        return new Response("cross-origin consent submissions are refused", { status: 403 })
    }

    const contentType = request.headers.get("content-type") ?? ""
    if (!contentType.includes("application/x-www-form-urlencoded")) {
        return new Response("unsupported content type", { status: 415 })
    }

    let form: URLSearchParams
    try {
        form = new URLSearchParams(await request.text())
    } catch {
        return new Response("could not parse the request body", { status: 400 })
    }

    const user = await Supabase.currentUser()
    // Session expired between rendering the form and clicking. Send them back
    // through login and re-render the consent screen rather than failing flat.
    if (!user) return seeOther(`/login?next=${encodeURIComponent(`/oauth/authorize?${consentQuery(form)}`)}`)

    // ── defence 3: re-validate from the registry, not from the form ──────────
    const query: AuthorizeQuery = {
        clientId: form.get("client_id") ?? undefined,
        redirectUri: form.get("redirect_uri") ?? undefined,
        responseType: form.get("response_type") ?? undefined,
        codeChallenge: form.get("code_challenge") ?? undefined,
        codeChallengeMethod: form.get("code_challenge_method") ?? undefined,
        scope: form.get("scope") ?? undefined,
        state: form.get("state") ?? undefined,
        resource: form.get("resource") ?? undefined,
    }

    const service = getOAuthAuthorizationService()
    const described = await service.describe(query)
    if (!described.ok) {
        const fault = described.fault
        if (fault.kind === "redirect") {
            return seeOther(
                AuthorizationRequest.buildErrorUrl(
                    fault.redirectUri,
                    fault.error,
                    fault.description,
                    fault.state,
                    OAuthServerConfig.issuer(),
                ),
            )
        }
        // Un-redirectable: bounce back to the consent page, which renders the
        // same refusal with an explanation instead of forwarding it anywhere.
        return seeOther(`/oauth/authorize?${consentQuery(form)}`) // re-enters via the session-checking gateway
    }
    const authorizeRequest = described.request

    // ── defence 2: the session-bound, request-bound CSRF token ───────────────
    const csrfOk = await ConsentCsrf.verify(
        form.get("csrf") ?? "",
        await ConsentSessionSecret.read(),
        user.id,
        ConsentCsrf.bindingFor({
            clientId: authorizeRequest.clientId,
            redirectUri: authorizeRequest.redirectUri,
            codeChallenge: authorizeRequest.codeChallenge,
        }),
    )
    if (!csrfOk) {
        // Also the outcome when a session legitimately refreshed mid-consent, so
        // the recovery is "show the screen again", not a dead end.
        return seeOther(`/oauth/authorize?${consentQuery(form)}`) // re-enters via the session-checking gateway
    }

    // ── the decision ─────────────────────────────────────────────────────────
    if (form.get("decision") !== "approve") {
        return seeOther(
            authorizeRequest.errorUrl(
                "access_denied",
                "the user denied the request",
                OAuthServerConfig.issuer(),
            ),
        )
    }

    const issued = await service.issueCode(authorizeRequest, user.id)
    if (!issued.ok) {
        return seeOther(
            authorizeRequest.errorUrl("server_error", issued.error.description, OAuthServerConfig.issuer()),
        )
    }

    return seeOther(authorizeRequest.successUrl(issued.code, OAuthServerConfig.issuer()))
}

/** 303 so the browser follows with GET — the form POST must not be replayed at
 *  the client's callback. */
function seeOther(location: string): Response {
    return new Response(null, {
        status: 303,
        headers: { Location: location, "Cache-Control": "no-store" },
    })
}

/** Rebuild the authorization query from the submitted form, for the round trips
 *  that re-render the consent screen. `csrf`/`decision` are ours, not the
 *  client's, so they are dropped. */
function consentQuery(form: URLSearchParams): string {
    const search = new URLSearchParams()
    for (const key of ["client_id", "redirect_uri", "response_type", "code_challenge", "code_challenge_method", "scope", "state", "resource"]) {
        const value = form.get(key)
        if (value !== null) search.set(key, value)
    }
    return search.toString()
}

/** The Origin header is authoritative when present (browsers always send it on a
 *  cross-origin form POST); Referer is the fallback for the rare client that
 *  omits Origin. A request with neither is refused rather than trusted. */
function isSameOrigin(request: Request): boolean {
    const expected = new URL(request.url).origin
    const configured = OAuthServerConfig.issuer()

    const origin = request.headers.get("origin")
    if (origin) return origin === expected || (configured !== "" && origin === configured)

    const referer = request.headers.get("referer")
    if (referer) {
        try {
            const refererOrigin = new URL(referer).origin
            return refererOrigin === expected || (configured !== "" && refererOrigin === configured)
        } catch {
            return false
        }
    }
    return false
}
