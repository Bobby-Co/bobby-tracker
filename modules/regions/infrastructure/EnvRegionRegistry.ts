// Regions infrastructure — the env-backed RegionRegistry. Owns the entire
// convention for declaring topology in the environment:
//
//     BOBBY_HOME_CELL=ashburn-0
//     BOBBY_CELLS=ashburn-0:north-america,bangkok-0:south-east-asia
//     BOBBY_ANALYSER_URL_ASHBURN_0     BOBBY_ANALYSER_TOKEN_ASHBURN_0
//     BOBBY_ANALYSER_URL_BANGKOK_0     BOBBY_ANALYSER_TOKEN_BANGKOK_0
//     BOBBY_SUPABASE_URL_BANGKOK_0     BOBBY_SUPABASE_SERVICE_ROLE_KEY_BANGKOK_0
//
// The analyser pair and the database pair are declared INDEPENDENTLY, because a
// cell legitimately has one without the other: every cell serves analysis from
// its own region long before its rows move there. A cell with an analyser and no
// database keeps its data central, which is the state the whole topology starts
// in.
//
// Adding a cell is one manifest entry plus its URL/token pair. No code change, no
// migration, no deploy — which is the whole point of the ids being open slugs
// rather than a union.
//
// Two compatibility rules, both deliberate:
//
//   1. With BOBBY_CELLS unset, the topology is a single cell (the home cell) in a
//      default region, served by the UNSUFFIXED BOBBY_ANALYSER_URL/TOKEN pair.
//      A deployment that predates all of this therefore keeps working untouched.
//   2. The unsuffixed pair serves the HOME cell only. A second cell that has no
//      config of its own reads as empty rather than inheriting Ashburn's URL —
//      a half-configured cell must fail loudly, not quietly send Bangkok's work
//      to Virginia.
//
// Env is read per call, never at module load: a module-level const is frozen into
// the Workers isolate at first import.

import { deriveCellLabel, parseCellId, type CellId } from "../domain/CellId"
import { deriveRegionLabel, parseRegionId, type RegionId } from "../domain/RegionId"
import type { CellConfig, RegionConfig, RegionRegistry } from "../ports/RegionRegistry"

/** Where a deployment that has declared nothing is assumed to be. Both are
 *  overridable; they exist so the zero-config path has concrete answers. */
const DEFAULT_HOME_CELL = "ashburn-0" as CellId
const DEFAULT_HOME_REGION = "north-america" as RegionId

/** `bangkok-0` → `BANGKOK_0`. */
function envSuffix(cell: CellId): string {
    return cell.toUpperCase().replace(/-/g, "_")
}

export class EnvRegionRegistry implements RegionRegistry {
    homeCell(): CellId {
        return parseCellId(process.env.BOBBY_HOME_CELL) ?? DEFAULT_HOME_CELL
    }

    /** The declared topology as (cell → region) pairs, in manifest order.
     *
     *  Entries that don't parse are DROPPED rather than throwing: a typo in one
     *  cell must not take down routing for every other cell. The home cell is
     *  always present, so the list is never empty. */
    private manifest(): { cell: CellId; region: RegionId }[] {
        const home = this.homeCell()
        const raw = process.env.BOBBY_CELLS || ""
        const parsed: { cell: CellId; region: RegionId }[] = []

        for (const entry of raw.split(",")) {
            const [rawCell, rawRegion] = entry.split(":")
            const cell = parseCellId(rawCell?.trim())
            const region = parseRegionId(rawRegion?.trim())
            if (!cell || !region) continue
            if (parsed.some((p) => p.cell === cell)) continue
            parsed.push({ cell, region })
        }

        // Guarantee the home cell is declared even when the manifest is absent or
        // forgot it — otherwise a zero-config deployment has no topology at all.
        if (!parsed.some((p) => p.cell === home)) {
            const region = parseRegionId(process.env.BOBBY_HOME_REGION) ?? DEFAULT_HOME_REGION
            parsed.unshift({ cell: home, region })
        }
        return parsed
    }

    cell(id: CellId): CellConfig {
        const suffix = envSuffix(id)
        const isHome = id === this.homeCell()
        // Legacy unsuffixed vars apply to the home cell ONLY — see rule 2 above.
        const legacyUrl = isHome ? process.env.BOBBY_ANALYSER_URL : undefined
        const legacyToken = isHome ? process.env.BOBBY_ANALYSER_TOKEN : undefined
        // The home cell's database IS the control database. That is not a
        // fallback — it is the definition: everything starts central, and the
        // home cell is the name for "where central is". Rule 2 still applies to
        // every OTHER cell, which reads empty until given its own pair.
        const homeDbUrl = isHome ? process.env.NEXT_PUBLIC_SUPABASE_URL : undefined
        const homeDbKey = isHome ? process.env.SUPABASE_SERVICE_ROLE_KEY : undefined

        const declared = this.manifest().find((p) => p.cell === id)

        return {
            id,
            region: declared?.region ?? DEFAULT_HOME_REGION,
            label: process.env[`BOBBY_CELL_LABEL_${suffix}`] || deriveCellLabel(id),
            analyserUrl: process.env[`BOBBY_ANALYSER_URL_${suffix}`] || legacyUrl || "",
            analyserToken: process.env[`BOBBY_ANALYSER_TOKEN_${suffix}`] || legacyToken || "",
            supabaseUrl: process.env[`BOBBY_SUPABASE_URL_${suffix}`] || homeDbUrl || "",
            supabaseServiceKey:
                process.env[`BOBBY_SUPABASE_SERVICE_ROLE_KEY_${suffix}`] || homeDbKey || "",
        }
    }

    /** Both halves required. A URL without its key would authenticate as anon
     *  against a database whose RLS is deny-all, so every read would come back
     *  empty and look like missing data rather than a misconfiguration. */
    hasDatabase(cell: CellId): boolean {
        const c = this.cell(cell)
        return c.supabaseUrl !== "" && c.supabaseServiceKey !== ""
    }

    isConfigured(cell: CellId): boolean {
        return this.cell(cell).analyserUrl !== ""
    }

    configuredCells(): CellConfig[] {
        return this.manifest()
            .map((p) => this.cell(p.cell))
            .filter((c) => c.analyserUrl !== "")
    }

    regions(): RegionConfig[] {
        const byRegion = new Map<RegionId, CellConfig[]>()
        for (const cell of this.configuredCells()) {
            const list = byRegion.get(cell.region)
            if (list) list.push(cell)
            else byRegion.set(cell.region, [cell])
        }
        return [...byRegion.entries()].map(([id, cells]) => ({
            id,
            label: process.env[`BOBBY_REGION_LABEL_${id.toUpperCase().replace(/-/g, "_")}`] || deriveRegionLabel(id),
            cells,
        }))
    }

    /** Deterministic today: the first configured cell declared in the region, so
     *  placement is stable and reproducible. Manifest order is therefore the
     *  operator's preference order. Load-aware selection replaces this body and
     *  nothing else. */
    assignCell(region: RegionId): CellId | null {
        return this.configuredCells().find((c) => c.region === region)?.id ?? null
    }
}
