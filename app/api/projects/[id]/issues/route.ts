import { jsonError, requireUser } from "@/lib/api"
import type { Issue } from "@/lib/supabase/types"

// GET /api/projects/[id]/issues — all issues for a project, newest first.
// Mirrors the read previously done server-side by the issues page (and the
// peek-others read on the issue detail page, which is a subset filtered
// client-side). Shape: { issues: Issue[] }.
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    const { supabase, error } = await requireUser()
    if (error) return error

    const { data, error: dbErr } = await supabase
        .from("issues")
        .select("*")
        .eq("project_id", id)
        .order("updated_at", { ascending: false })
        // Safety cap — realistic projects are far under this; prevents a
        // pathological project from shipping a huge payload (CPU on
        // serialization + memory) in a single Worker request.
        .limit(1000)
        .returns<Issue[]>()
    if (dbErr) return jsonError("db_error", dbErr.message, 500)
    return Response.json({ issues: data ?? [] })
}
