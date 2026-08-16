// Regions module — the RegionRegistry PORT. Knows the topology: which regions
// exist, which cells sit inside them, and where a new project should be placed.
// Callers depend on this interface and obtain an implementation from
// ../Composition.

import type { CellId } from "../domain/CellId"
import type { RegionId } from "../domain/RegionId"

/** One deployment unit: exactly one analyser, inside exactly one region.
 *
 *  `analyserUrl` may be empty — meaning "this cell is declared but has nothing
 *  behind it yet". The registry reports that faithfully instead of substituting
 *  another cell's URL; the consumer (HttpAnalyser) turns it into a loud
 *  not_configured error. Falling back would send a project's work to a backend
 *  that has never indexed its repo. */
export interface CellConfig {
    id: CellId
    region: RegionId
    label: string
    analyserUrl: string
    analyserToken: string
}

/** A user-facing geography, and the cells available inside it. */
export interface RegionConfig {
    id: RegionId
    label: string
    cells: CellConfig[]
}

export interface RegionRegistry {
    /** The cell every pre-existing project lives in, and the fallback for work
     *  that touches no repo graph (embeddings, issue composition). */
    homeCell(): CellId

    /** Config for one cell. Never throws and never falls back — an undeclared or
     *  unconfigured cell comes back with empty endpoint fields. */
    cell(id: CellId): CellConfig

    /** Whether this cell has an analyser behind it right now. */
    isConfigured(cell: CellId): boolean

    /** Every cell with an analyser configured, across all regions. */
    configuredCells(): CellConfig[]

    /** Regions that have at least one configured cell — the list a customer picks
     *  from. A region whose cells are all unconfigured is not offered. */
    regions(): RegionConfig[]

    /** Choose the cell for a NEW project in this region, or null when the region
     *  has no configured cell to place it in.
     *
     *  This is the seam for capacity-aware placement. Today it is deterministic
     *  (first configured cell); when a region has several, this is the one method
     *  that has to learn about load, and no caller changes. */
    assignCell(region: RegionId): CellId | null
}
