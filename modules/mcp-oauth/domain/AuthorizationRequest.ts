// The `/oauth/authorize` request as a validated value object, plus the rule that
// decides HOW a bad request is reported.
//
// THE RULE THAT MATTERS (RFC 6749 §4.1.2.1). There are two classes of failure and
// they must be handled differently:
//
//   • The client_id is unknown, or the redirect_uri is missing / unregistered.
//     We have NO trustworthy place to send the user, so we MUST NOT redirect —
//     doing so would turn the authorization endpoint into an open redirector that
//     forwards error details (and the user) to an attacker-chosen URL. These
//     surface as `kind: "render"` and the page shows an error instead.
//
//   • Everything else (bad response_type, missing/plain PKCE, unknown scope).
//     The redirect_uri is proven registered by then, so the error goes BACK to
//     the client as `?error=…&state=…`, which is what lets a client show a real
//     message instead of hanging. These surface as `kind: "redirect"`.
//
// Pure: the caller resolves the client row and passes the few fields this needs
// as a local value object, per the modules/README rule about domain code not
// importing DB types.

import { Pkce } from "./Pkce"
import { RedirectUris } from "./RedirectUris"

/** The only scope this server issues. */
export const MCP_SCOPE = "mcp:read"

/** The client fields the request validator reads — declared locally so domain
 *  code carries no dependency on the persistence shape. */
export interface ConsentingClient {
    clientId: string
    clientName: string
    redirectUris: string[]
}

/** Raw query values, exactly as they arrived. */
export interface AuthorizeQuery {
    clientId?: string
    redirectUri?: string
    responseType?: string
    codeChallenge?: string
    codeChallengeMethod?: string
    scope?: string
    state?: string
    resource?: string
}

export type AuthorizeFault =
    /** Render an error page — redirecting would be unsafe. */
    | { kind: "render"; code: string; message: string }
    /** Send the error back to the (proven-registered) redirect_uri. */
    | { kind: "redirect"; redirectUri: string; error: string; description: string; state: string | null }

export class AuthorizationRequest {
    private constructor(
        readonly clientId: string,
        readonly clientName: string,
        readonly redirectUri: string,
        readonly codeChallenge: string,
        readonly scope: string,
        readonly state: string | null,
        readonly resource: string | null,
    ) {}

    /** Validate a raw query against the resolved client. `client` is null when the
     *  client_id matched nothing. */
    static validate(
        query: AuthorizeQuery,
        client: ConsentingClient | null,
    ): { ok: true; request: AuthorizationRequest } | { ok: false; fault: AuthorizeFault } {
        const state = query.state ?? null

        // ── un-redirectable failures ────────────────────────────────────────
        if (!query.clientId) {
            return render("invalid_request", "This authorization link is missing its client_id.")
        }
        if (!client) {
            return render(
                "invalid_client",
                "This application is not registered with Ucelot, so the request can't be approved.",
            )
        }
        if (!query.redirectUri) {
            return render("invalid_request", "This authorization link is missing its redirect_uri.")
        }
        if (!RedirectUris.isRegistered(client.redirectUris, query.redirectUri)) {
            return render(
                "invalid_request",
                "The redirect address in this link isn't one this application registered. " +
                    "For your safety the request was stopped instead of being sent on.",
            )
        }
        const redirectUri = query.redirectUri

        // ── redirectable failures — the client learns what it got wrong ─────
        if (query.responseType !== "code") {
            return back(redirectUri, "unsupported_response_type", "only response_type=code is supported", state)
        }
        if (!query.codeChallenge) {
            return back(redirectUri, "invalid_request", "code_challenge is required (PKCE)", state)
        }
        // OAuth 2.1 drops `plain`; an absent method historically DEFAULTED to
        // plain, so an omitted method is rejected too rather than silently
        // downgrading the protection.
        if (query.codeChallengeMethod !== Pkce.METHOD) {
            return back(
                redirectUri,
                "invalid_request",
                "code_challenge_method must be S256",
                state,
            )
        }
        if (!Pkce.isWellFormedChallenge(query.codeChallenge)) {
            return back(redirectUri, "invalid_request", "malformed code_challenge", state)
        }

        // A single scope exists. Absent means "the default"; anything else must
        // resolve to exactly it.
        const requested = (query.scope ?? "").trim()
        if (requested) {
            const granted = requested.split(/\s+/).filter(Boolean)
            if (granted.some((s) => s !== MCP_SCOPE)) {
                return back(redirectUri, "invalid_scope", `only "${MCP_SCOPE}" is supported`, state)
            }
        }

        return {
            ok: true,
            request: new AuthorizationRequest(
                client.clientId,
                client.clientName,
                redirectUri,
                query.codeChallenge,
                MCP_SCOPE,
                state,
                query.resource?.trim() || null,
            ),
        }
    }

    /** The success redirect: code + state + `iss` (RFC 9207 — lets the client
     *  detect a mix-up attack by confirming which AS answered). */
    successUrl(code: string, issuer: string): string {
        const url = new URL(this.redirectUri)
        url.searchParams.set("code", code)
        if (this.state !== null) url.searchParams.set("state", this.state)
        url.searchParams.set("iss", issuer)
        return url.toString()
    }

    /** The denial/error redirect, same shape. */
    errorUrl(error: string, description: string, issuer: string): string {
        return AuthorizationRequest.buildErrorUrl(this.redirectUri, error, description, this.state, issuer)
    }

    static buildErrorUrl(
        redirectUri: string,
        error: string,
        description: string,
        state: string | null,
        issuer: string,
    ): string {
        const url = new URL(redirectUri)
        url.searchParams.set("error", error)
        if (description) url.searchParams.set("error_description", description)
        if (state !== null) url.searchParams.set("state", state)
        url.searchParams.set("iss", issuer)
        return url.toString()
    }
}

function render(code: string, message: string): { ok: false; fault: AuthorizeFault } {
    return { ok: false, fault: { kind: "render", code, message } }
}

function back(
    redirectUri: string,
    error: string,
    description: string,
    state: string | null,
): { ok: false; fault: AuthorizeFault } {
    return { ok: false, fault: { kind: "redirect", redirectUri, error, description, state } }
}
