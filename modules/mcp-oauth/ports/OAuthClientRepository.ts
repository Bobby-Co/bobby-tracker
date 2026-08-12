// mcp-oauth — the registered-clients persistence PORT.

import type { NewOAuthClient, OAuthClientRecord } from "./OAuthTypes"

export interface OAuthClientRepository {
    /** The client, or null when the id matches nothing. THROWS RepositoryError on
     *  an infrastructure failure — "the store is broken" must not be mistaken for
     *  "the client isn't registered", which would silently deny every request. */
    find(clientId: string): Promise<OAuthClientRecord | null>

    /** Persist a Dynamic Client Registration. Throws on failure. */
    create(client: NewOAuthClient): Promise<OAuthClientRecord>
}
