import { jsonError, requireUser } from "@/lib/api"
import type { ProjectAnalyser } from "@/lib/supabase/types"

export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    const { supabase, error } = await requireUser()
    if (error) return error

    const { data, error: dbErr } = await supabase
        .from("project_analyser")
        .upsert(
            { project_id: id, enabled: false, status: "disabled" },
            { onConflict: "project_id" },
        )
        .select("*")
        .single<ProjectAnalyser>()
    if (dbErr) return jsonError("db_error", dbErr.message, 500)
    return Response.json({ analyser: data })
}
