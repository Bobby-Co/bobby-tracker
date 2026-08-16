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
    /** The cell's DATA-plane database. Empty means "this cell has no database of
     *  its own", which is a different state from the analyser being missing — a
     *  cell may have an analyser and still keep its rows centrally. Callers must
     *  treat empty as fail-closed, never as "use the control database": silently
     *  falling back would write one team's issues into another region and the
     *  mistake would only surface as missing data much later. */
    supabaseUrl: string
    supabaseServiceKey: string
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

    /** Whether this cell has a data-plane database of its own. Independent of
     *  isConfigured: a cell can serve analysis from its own region while its rows
     *  still live centrally, which is every cell's state before the split is
     *  switched on. */
    hasDatabase(cell: CellId): boolean

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
