// An OAuth failure as a VALUE (kernel rule: errors are values, not thrown
// control-flow). Carries the RFC 6749 §5.2 / RFC 7591 §3.2.2 machine-readable
// code plus the HTTP status the interface layer should use — the mapping lives
// with the protocol that defines it, not scattered across route handlers.

import { DomainError } from "@/lib/shared/kernel"

export class OAuthError extends DomainError {
    readonly status: number
    readonly description: string

    constructor(code: string, description: string, status = 400) {
        super(code, description)
        this.name = "OAuthError"
        this.status = status
        this.description = description
    }

    /** The wire body for a token/registration error response. */
    toJson(): { error: string; error_description: string } {
        return { error: this.code, error_description: this.description }
    }

    // ─── the codes this server actually emits ───────────────────────────────

    /** Malformed request: a required parameter is missing, repeated, or invalid. */
    static invalidRequest(description: string) {
        return new OAuthError("invalid_request", description, 400)
    }

    /** Client authentication failed / the client is unknown. 401 so the caller can
     *  tell "you are nobody" apart from "your grant is bad". */
    static invalidClient(description: string) {
        return new OAuthError("invalid_client", description, 401)
    }

    /** The code/refresh token is invalid, expired, revoked, replayed, or was
     *  issued to another client. Deliberately ONE code for all of those — telling
     *  a caller *which* is an oracle. */
    static invalidGrant(description: string) {
        return new OAuthError("invalid_grant", description, 400)
    }

    static unsupportedGrantType(description: string) {
        return new OAuthError("unsupported_grant_type", description, 400)
    }

    static invalidScope(description: string) {
        return new OAuthError("invalid_scope", description, 400)
    }

    /** RFC 8707 §2 — the requested `resource` isn't one this grant covers. */
    static invalidTarget(description: string) {
        return new OAuthError("invalid_target", description, 400)
    }

    /** RFC 7591 §3.2.2 registration failures. */
    static invalidRedirectUri(description: string) {
        return new OAuthError("invalid_redirect_uri", description, 400)
    }

    static invalidClientMetadata(description: string) {
        return new OAuthError("invalid_client_metadata", description, 400)
    }

    /** The store failed. Not a protocol error — surfaced as 500. */
    static serverError(description: string) {
        return new OAuthError("server_error", description, 500)
    }
}
