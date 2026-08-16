// Regions module — PUBLIC CONTRACT (see modules/README.md).
//
// Two levels, and the distinction matters at every call site:
//
//   REGION  — `south-east-asia`. Coarse geography. What a customer PICKS, what a
//             residency question is answered in, what the UI shows.
//   CELL    — `bangkok-0`. One deployment unit with one analyser behind it. What
//             the app ROUTES on. Internal; a customer never sees it.
//
// A project stores both: the region it was placed in (stable, meaningful) and the
// cell holding its knowledge graph (an implementation detail that could be
// rebalanced within the region). Routing keys off the CELL — passing a region to
// getAnalyser is a type error, which is why both ids are branded.
//
// Neither is an authorization concept. Placement decides which backend answers,
// never who may ask; that stays with modules/access, on team_id.

export { isRegionId, parseRegionId, deriveRegionLabel } from "./domain/RegionId"
export type { RegionId } from "./domain/RegionId"

export { isCellId, parseCellId, deriveCellLabel } from "./domain/CellId"
export type { CellId } from "./domain/CellId"

export type { CellConfig, RegionConfig, RegionRegistry } from "./ports/RegionRegistry"
export { getRegionRegistry } from "./Composition"
