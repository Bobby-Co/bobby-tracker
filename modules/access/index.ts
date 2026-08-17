// Access bounded context — PUBLIC CONTRACT (see modules/README.md). The
// authorization context: the app-layer "rich logic" half of the HYBRID authz
// model (migration 0052). Owns no tables — a policy over the Teams and Projects
// repositories. Routes and the http guard layer authorize through this contract.

// ─── Role value object — the null-safe role ordering ────────────────────────
export { Role } from "./domain/Role"
export type { TeamRoleValue } from "./domain/Role"

// ─── the access policy (pure decisions) ─────────────────────────────────────
export { AccessPolicy } from "./domain/AccessPolicy"

// ─── the application service + its composition seam ─────────────────────────
export { AccessService } from "./application/AccessService"
export type { ProjectAccess } from "./application/AccessService"
export { getAccessService } from "./Composition"
