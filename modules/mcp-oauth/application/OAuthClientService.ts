// Dynamic Client Registration (RFC 7591) — the use case behind
// POST /api/oauth/register.
//
// The endpoint is deliberately OPEN (no initial access token): that is what lets
// Claude Code discover this server and register itself with zero manual setup,
// and it is the model the MCP authorization spec assumes. Registering is not a
// privilege — a registered client can do nothing until a HUMAN approves it on the
// consent screen, and even then it only ever acts as that one user. The abuse
// surface is therefore row-stuffing, which is bounded here (redirect-URI count +
// length, name/URI length) and rate-limited at the route.

import { ok, err, type Result } from "@/lib/shared/kernel"
import { OAuthError } from "../domain/OAuthError"
import { OpaqueSecret } from "../domain/OpaqueSecret"
import { RedirectUris } from "../domain/RedirectUris"
import type { OAuthClientRepository } from "../ports/OAuthClientRepository"
import type { OAuthClientRecord, TokenEndpointAuthMethod } from "../ports/OAuthTypes"

const MAX_NAME_LENGTH = 200
const SUPPORTED_GRANT_TYPES = ["authorization_code", "refresh_token"] as const
const SUPPORTED_AUTH_METHODS: TokenEndpointAuthMethod[] = ["none", "client_secret_basic", "client_secret_post"]

/** The raw registration body, still untrusted. */
export interface RegistrationRequest {
    client_name?: unknown
    redirect_uris?: unknown
    grant_types?: unknown
    token_endpoint_auth_method?: unknown
    client_uri?: unknown
}

/** The registration result: the stored record plus the ONE-TIME secret, which
 *  exists only for a confidential client and is never retrievable again. */
export interface RegisteredClient {
    record: OAuthClientRecord
    clientSecret: string | null
}

export class OAuthClientService {
    constructor(private readonly clients: OAuthClientRepository) {}

    async register(body: RegistrationRequest): Promise<Result<RegisteredClient, OAuthError>> {
        const uris = RedirectUris.validateList(body.redirect_uris)
        if (!uris.ok) return err(OAuthError.invalidRedirectUri(uris.reason))

        const name = typeof body.client_name === "string" ? body.client_name.trim() : ""
        if (name.length > MAX_NAME_LENGTH) {
            return err(OAuthError.invalidClientMetadata(`client_name must be ${MAX_NAME_LENGTH} characters or fewer`))
        }

        let clientUri: string | null = null
        if (body.client_uri !== undefined && body.client_uri !== null && body.client_uri !== "") {
            if (typeof body.client_uri !== "string" || !RedirectUris.isAllowedClientUri(body.client_uri)) {
                return err(OAuthError.invalidClientMetadata("client_uri must be an absolute https:// URI"))
            }
            clientUri = body.client_uri
        }

        const grantTypes = normaliseGrantTypes(body.grant_types)
        if (!grantTypes.ok) return err(OAuthError.invalidClientMetadata(grantTypes.reason))

        const authMethod = normaliseAuthMethod(body.token_endpoint_auth_method)
        if (!authMethod.ok) return err(OAuthError.invalidClientMetadata(authMethod.reason))

        // A public client (`none`) gets NO secret — it could not keep one anyway,
        // which is precisely why PKCE is mandatory on every authorization here.
        const clientSecret = authMethod.value === "none" ? null : OpaqueSecret.mint(OpaqueSecret.CLIENT_SECRET_PREFIX)

        try {
            const record = await this.clients.create({
                clientId: OpaqueSecret.mintClientId(),
                clientSecretHash: clientSecret ? await OpaqueSecret.hash(clientSecret) : null,
                clientName: name || "MCP client",
                redirectUris: uris.uris,
                grantTypes: grantTypes.value,
                tokenEndpointAuthMethod: authMethod.value,
                clientUri,
            })
            return ok({ record, clientSecret })
        } catch (e) {
            return err(OAuthError.serverError(e instanceof Error ? e.message : "registration failed"))
        }
    }
}

function normaliseGrantTypes(value: unknown): { ok: true; value: string[] } | { ok: false; reason: string } {
    if (value === undefined || value === null) return { ok: true, value: [...SUPPORTED_GRANT_TYPES] }
    if (!Array.isArray(value) || value.length === 0) {
        return { ok: false, reason: "grant_types must be a non-empty array when present" }
    }
    const requested = value.filter((g): g is string => typeof g === "string")
    const unsupported = requested.filter((g) => !SUPPORTED_GRANT_TYPES.includes(g as (typeof SUPPORTED_GRANT_TYPES)[number]))
    if (requested.length !== value.length || unsupported.length > 0) {
        return { ok: false, reason: `grant_types must be a subset of ${SUPPORTED_GRANT_TYPES.join(", ")}` }
    }
    // authorization_code is the only way in; refresh_token is a follow-on. Keep
    // authorization_code registered even if the client only asked for refresh.
    const set = new Set(requested)
    set.add("authorization_code")
    return { ok: true, value: [...set] }
}

function normaliseAuthMethod(
    value: unknown,
): { ok: true; value: TokenEndpointAuthMethod } | { ok: false; reason: string } {
    if (value === undefined || value === null || value === "") return { ok: true, value: "none" }
    if (typeof value !== "string" || !SUPPORTED_AUTH_METHODS.includes(value as TokenEndpointAuthMethod)) {
        return { ok: false, reason: `token_endpoint_auth_method must be one of ${SUPPORTED_AUTH_METHODS.join(", ")}` }
    }
    return { ok: true, value: value as TokenEndpointAuthMethod }
}
