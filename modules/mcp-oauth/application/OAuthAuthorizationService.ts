// The authorization-endpoint use cases: resolve + validate an inbound
// /oauth/authorize request, and mint the single-use code once a human approves.
//
// The consent screen calls `describe()` on GET (to know what to show, or which
// error to show) and the approve action calls `describe()` AGAIN before
// `issueCode()` — the second call is not redundant. The parameters travel through
// the browser in hidden form fields, so they are attacker-controllable input on
// the POST exactly as they were on the GET, and re-validating is what stops a
// tampered redirect_uri from being honoured just because the GET looked fine.

import { AUTHORIZATION_CODE_TTL_SECONDS } from "../ports/OAuthTypes"
import { AuthorizationRequest, type AuthorizeFault, type AuthorizeQuery } from "../domain/AuthorizationRequest"
import { OAuthError } from "../domain/OAuthError"
import { OpaqueSecret } from "../domain/OpaqueSecret"
import type { OAuthClientRepository } from "../ports/OAuthClientRepository"
import type { OAuthCodeRepository } from "../ports/OAuthCodeRepository"

export type DescribeResult =
    | { ok: true; request: AuthorizationRequest }
    | { ok: false; fault: AuthorizeFault }

export class OAuthAuthorizationService {
    constructor(
        private readonly clients: OAuthClientRepository,
        private readonly codes: OAuthCodeRepository,
    ) {}

    /** Resolve the client and validate the query. Never throws: a store failure
     *  becomes a rendered error, because we cannot safely redirect when we don't
     *  know whether the redirect_uri is genuine. */
    async describe(query: AuthorizeQuery): Promise<DescribeResult> {
        let client = null
        if (query.clientId) {
            try {
                client = await this.clients.find(query.clientId)
            } catch {
                return {
                    ok: false,
                    fault: {
                        kind: "render",
                        code: "server_error",
                        message: "We couldn't look up this application right now. Please try again.",
                    },
                }
            }
        }
        return AuthorizationRequest.validate(query, client)
    }

    /** Mint the authorization code for an APPROVED request. Returns the raw code —
     *  only its hash is stored, so this is the one and only time it exists in a
     *  readable form. */
    async issueCode(request: AuthorizationRequest, userId: string): Promise<{ ok: true; code: string } | { ok: false; error: OAuthError }> {
        const code = OpaqueSecret.mint(OpaqueSecret.CODE_PREFIX)
        try {
            await this.codes.create({
                codeHash: await OpaqueSecret.hash(code),
                clientId: request.clientId,
                userId,
                redirectUri: request.redirectUri,
                codeChallenge: request.codeChallenge,
                scope: request.scope,
                resource: request.resource,
                expiresAt: new Date(Date.now() + AUTHORIZATION_CODE_TTL_SECONDS * 1000).toISOString(),
            })
        } catch (e) {
            return { ok: false, error: OAuthError.serverError(e instanceof Error ? e.message : "could not issue code") }
        }
        return { ok: true, code }
    }
}
