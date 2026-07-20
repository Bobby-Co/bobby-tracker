import { repoRead, requireProjectAccess } from "@/lib/api"
import { createSupabaseProjectAnalyserRepository } from "@/modules/analysis"

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    const { supabase, error } = await requireProjectAccess(id)
    if (error) return error

    const { data, error: dbErr } = await repoRead(() =>
        createSupabaseProjectAnalyserRepository(supabase).findByProjectId(id),
    )
    if (dbErr) return dbErr
    return Response.json({ analyser: data })
}
