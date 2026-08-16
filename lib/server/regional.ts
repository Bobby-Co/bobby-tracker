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
import { getRegionRegistry, type CellId } from "@/modules/regions"
import { createSupabaseProjectsRepository } from "@/modules/projects"

/** The data-plane client for a cell. Falls back to the CONTROL client when the
 *  cell has no database of its own — which is every cell before its rows are
 *  moved, and is the honest answer rather than a guess. */
export function dataClientForCell(cell: CellId | null): SupabaseRlsClient {
    const control = Supabase.service() as SupabaseRlsClient
    if (!cell) return control
    const registry = getRegionRegistry()
    if (!registry.hasDatabase(cell)) return control
    const cfg = registry.cell(cell)
    return Supabase.forRegion(cfg.supabaseUrl, cfg.supabaseServiceKey, cell) as SupabaseRlsClient
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
    return dataClientForCell(cell)
}
