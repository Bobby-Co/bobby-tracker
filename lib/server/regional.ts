// Regional data-plane client resolution for the paths that do NOT go through
// RequestContext — inbound webhooks, analyser callbacks, public submission, and
// the service-role stores those use.
//
// RequestContext binds its data plane from the guard that authenticated the
// request. These paths have no guard and no session: a webhook arrives from
// GitHub, a callback arrives from the analyser. What they always DO have is a
// project id, and placement is per team (0064), so the project's owning team
// answers which database its rows belong in.
//
// Why this matters more than it looks: these are the WRITE paths. A read sent to
// the wrong region returns empty and someone notices. A write sent to the wrong
// region succeeds, and the rows sit in a database nothing will ever read them
// from — and with no scheduler in this stack, nothing comes along later to
// reconcile them.

import { Supabase, type SupabaseRlsClient } from "@/lib/server/supabase"
import { getRegionRegistry, parseCellId, type CellId } from "@/modules/regions"
import { createSupabaseProjectsRepository } from "@/modules/projects"
import { dbRef, trace } from "@/lib/server/trace"

/** The data-plane client for a cell. Falls back to the CONTROL client when the
 *  cell has no database of its own — which is every cell before its rows are
 *  moved, and is the honest answer rather than a guess. */
export function dataClientForCell(cell: CellId | null): SupabaseRlsClient {
    const control = Supabase.service() as SupabaseRlsClient
    if (!cell) {
        trace("data.client", { cell: null, resolved: "control", why: "no cell" })
        return control
    }
    const registry = getRegionRegistry()
    if (!registry.hasDatabase(cell)) {
        trace("data.client", { cell, resolved: "control", why: "cell has no database configured" })
        return control
    }
    const cfg = registry.cell(cell)
    trace("data.client", { cell, resolved: "regional", db: dbRef(cfg.supabaseUrl) })
    return Supabase.forRegion(cfg.supabaseUrl, cfg.supabaseServiceKey, cell) as SupabaseRlsClient
}

/** The header the analyser stamps on its callbacks, naming the cell it ran in.
 *  Same constant as bobby-analyser's `CellHeader`. */
export const CELL_HEADER = "x-bobby-cell"

/** The data-plane client holding a row that is only identifiable by id.
 *
 *  This is the analyser-callback problem: the request carries a task id and
 *  nothing else, and the row that id refers to is itself regional — so the
 *  lookup needs the answer it is trying to find. There is no user here whose
 *  teams could narrow it, either.
 *
 *  Two ways out, tried in order:
 *
 *  1. The analyser knows which cell it is and stamps X-Bobby-Cell on the
 *     callback. One hop, no guessing. This is the path that should normally win.
 *  2. Otherwise, PROBE the configured cells until the row turns up. Bounded by
 *     the number of cells (one, today) and self-correcting — unlike a central
 *     id → cell index, which is a second copy of the truth with nothing in this
 *     stack to repair it when it drifts.
 *
 *  Falls back to the control client when nothing matches, which is both the
 *  pre-split answer and the right one for a row that genuinely lives centrally. */
export async function dataClientByProbe(
    request: Request,
    probe: (db: SupabaseRlsClient) => Promise<boolean>,
): Promise<SupabaseRlsClient> {
    const registry = getRegionRegistry()

    const rawHeader = request.headers.get(CELL_HEADER)
    const stamped = parseCellId(rawHeader ?? undefined)
    if (stamped) {
        trace("probe.header", { header: rawHeader, cell: stamped })
        return dataClientForCell(stamped)
    }

    // Home first: it is where everything lives until it is moved, so the common
    // case costs one probe.
    const home = registry.homeCell()
    const candidates = [home, ...registry.configuredCells().map((c) => c.id).filter((id) => id !== home)]

    trace("probe.start", { header: rawHeader ?? null, home, candidates })

    for (const cell of candidates) {
        if (!registry.hasDatabase(cell) && cell !== home) {
            trace("probe.skip", { cell, why: "no database configured" })
            continue
        }
        const db = dataClientForCell(cell)
        try {
            const hit = await probe(db)
            trace("probe.try", { cell, hit })
            if (hit) return db
        } catch (e) {
            // A region that is unreachable must not abort the search — the row
            // may well be in the next one. But it must not be invisible either:
            // a probe that THROWS looks identical to one that finds nothing, and
            // that is how a broken region reads as "the row is elsewhere".
            trace("probe.error", { cell, error: e instanceof Error ? e.message : String(e) })
        }
    }
    trace("probe.exhausted", { fellBackTo: "control" })
    return Supabase.service() as SupabaseRlsClient
}

/** The data-plane client holding a project's regional rows.
 *
 *  Resolved through the project's TEAM, always from the control database — the
 *  lookup must never depend on the region it is trying to find. A project with no
 *  resolvable cell binds central, matching how RequestContext treats a team that
 *  predates placement. */
export async function dataClientForProject(projectId: string): Promise<SupabaseRlsClient> {
    const control = Supabase.service() as SupabaseRlsClient
    const cell = await createSupabaseProjectsRepository(control).findCell(projectId)
    trace("data.forProject", { projectId, cell })
    return dataClientForCell(cell)
}
