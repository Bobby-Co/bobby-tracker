// Account bounded context — PUBLIC CONTRACT (see modules/README.md).
//
// Owns the account LIFECYCLE — today, its end. Deleting an account is the most
// destructive operation in the product and the only one that spans everything:
// the teams a person owns, the regional content those teams' projects hold, the
// memberships that connect them to everyone else, and finally the login itself.
//
// The decision and the execution are deliberately separate. AccountDeletionPlan
// is PURE — it sorts every team the user belongs to into delete / leave / blocked
// and can be read and tested without a database in sight. Carrying the plan out
// belongs to the route (app/api/account), because it needs the request's unit of
// work to bind each team's REGION before purging its content, and region binding
// is a RequestContext concern rather than a module one.
//
// There is no undo, and no scheduler in this stack to build one on: the delete is
// immediate and complete, or it refuses.

// ─── domain: what deletion does to each team ─────────────────────────────────
export { AccountDeletionPlanner } from "./domain/AccountDeletionPlan"
export type { TeamFacts, DeletionPlan, Disposition } from "./domain/AccountDeletionPlan"

// ─── the identity itself ─────────────────────────────────────────────────────
export type { AccountIdentityStore } from "./ports/AccountIdentityStore"
export { createSupabaseAuthIdentityStore } from "./infrastructure/SupabaseAuthIdentityStore"
export { getAccountIdentityStore } from "./Composition"

// ─── lifecycle mail: the welcome and the farewell ────────────────────────────
export type { AccountMailer, WelcomeMessage, FarewellMessage } from "./ports/AccountMailer"
export type { WelcomeLedger } from "./ports/WelcomeLedger"
export { createAccountMailer, getWelcomeLedger } from "./Composition"
// The templates themselves, pure and transport-free, so they can be rendered
// and reviewed without sending one.
export { renderWelcomeEmail, renderFarewellEmail } from "./infrastructure/JmapAccountMailer"
