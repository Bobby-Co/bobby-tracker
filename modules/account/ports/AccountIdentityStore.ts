// AccountIdentityStore — the PORT for removing the identity itself.
//
// Separate from every other step of account deletion because it is the only one
// that leaves our schema: teams, projects and memberships are ours, the login is
// the identity provider's. It goes LAST, and that ordering is the reason this is
// its own port — once the auth row is gone there is no user id to find the rest
// of the data by, and nothing in this stack would ever come back for it.
export interface AccountIdentityStore {
    /** Permanently remove the account from the identity provider. Idempotent
     *  enough for a retry: deleting an id that no longer exists is not an error
     *  worth failing the request over. THROWS on a real failure. */
    delete(userId: string): Promise<void>
}
