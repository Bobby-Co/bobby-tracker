import { jsonError, requireProjectAccess } from "@/lib/api"
import type { ProjectAnalyser } from "@/lib/supabase/types"

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    const { supabase, error } = await requireProjectAccess(id)
    if (error) return error

    const { data, error: dbErr } = await supabase
        .from("project_analyser")
        .select("*")
        .eq("project_id", id)
        .maybeSingle<ProjectAnalyser>()
    if (dbErr) return jsonError("db_error", dbErr.message, 500)
    return Response.json({ analyser: data })
}
