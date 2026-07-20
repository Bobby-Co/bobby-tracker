// Teams bounded context — PUBLIC CONTRACT (see modules/README.md).
//
// Team invitations: token minting, email validation, and the invite email.
// (Team-based authorization — team-access/assertProjectAccess — is cross-cutting
// and stays in lib/auth, used by every route and the http helper.)
export * from "./infrastructure/invites"
