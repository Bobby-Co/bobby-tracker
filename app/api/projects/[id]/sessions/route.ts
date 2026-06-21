import { requireUser } from "@/lib/api"
import type { ProjectPublicIntegration, PublicSession } from "@/lib/supabase/types"

// GET /api/projects/[id]/sessions — backs the Integrations tab: the
// project's public-submissions integration row plus the public sessions
// that cover it. Both queries can fail independently when the public-*
// migrations haven't landed; we tolerate that with a `tableMissing`
// flag so the UI can show a single "pending migration" banner instead
// of erroring outright.
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    const { supabase, error } = await requireUser()
    if (error) return error

    const [{ data: integration, error: intErr }, { data: links, error: linkErr }] = await Promise.all([
        supabase
            .from("project_public_integration")
            .select("*")
            .eq("project_id", id)
            .maybeSingle<ProjectPublicIntegration>(),
        supabase
            .from("public_session_projects")
            .select("session_id,public_sessions(id,name,enabled,submission_count)")
            .eq("project_id", id),
    ])
    const tableMissing = !!intErr || !!linkErr

    type LinkRow = { session_id: string; public_sessions: Pick<PublicSession, "id" | "name" | "enabled" | "submission_count"> | Pick<PublicSession, "id" | "name" | "enabled" | "submission_count">[] | null }
    const sessions = ((links as unknown as LinkRow[]) ?? [])
        .map((r) => Array.isArray(r.public_sessions) ? r.public_sessions[0] : r.public_sessions)
        .filter((s): s is NonNullable<typeof s> => !!s)

    return Response.json({ integration: integration ?? null, sessions, tableMissing })
}
