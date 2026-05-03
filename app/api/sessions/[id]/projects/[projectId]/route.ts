import { jsonError, requireUser } from "@/lib/api"

export async function DELETE(
    _: Request,
    { params }: { params: Promise<{ id: string; projectId: string }> },
) {
    const { id, projectId } = await params
    const { supabase, error } = await requireUser()
    if (error) return error
    const { error: dbErr } = await supabase
        .from("public_session_projects")
        .delete()
        .eq("session_id", id)
        .eq("project_id", projectId)
    if (dbErr) return jsonError("db_error", dbErr.message, 500)
    return new Response(null, { status: 204 })
}
