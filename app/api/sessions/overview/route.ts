import { jsonError, requireUser } from "@/lib/api"
import type { PublicSession } from "@/lib/supabase/types"

// GET — everything the owner's /sessions list needs in one round-trip:
//   { sessions, projects, projectsBySession }
//
//  - sessions:           the user's public sessions, newest first.
//  - projects:           projects eligible for a NEW session — only those
//                        with the public-submissions integration enabled.
//  - projectsBySession:  a map of session id → project names, used to
//                        render the per-session project pills.
//
// Queries mirror the previous server component exactly so the rendered
// data is identical after the client conversion.
export async function GET() {
    const { supabase, error } = await requireUser()
    if (error) return error

    const { data: sessions, error: sessErr } = await supabase
        .from("public_sessions")
        .select("*")
        .order("updated_at", { ascending: false })
        .returns<PublicSession[]>()
    // Tolerate the table being absent (migration 0009 not yet applied)
    // — surface a distinct code so the UI can render the migration hint
    // rather than a generic error.
    if (sessErr) return jsonError("pending_migration", sessErr.message, 503)

    // Only enabled-integration projects are eligible for new sessions —
    // the inner-join filter via !inner ensures projects without a
    // matching project_public_integration row are excluded.
    const { data: enabledProjects } = await supabase
        .from("projects")
        .select("id,name,project_public_integration!inner(enabled)")
        .eq("project_public_integration.enabled", true)
        .order("name", { ascending: true })
    const projects = ((enabledProjects as unknown as { id: string; name: string }[]) ?? [])
        .map((p) => ({ id: p.id, name: p.name }))

    // Pull project counts per session via the junction. One round-trip;
    // we group here so the client just consumes the finished map.
    const sessionIds = (sessions ?? []).map((s) => s.id)
    const { data: links } = sessionIds.length
        ? await supabase
            .from("public_session_projects")
            .select("session_id,project_id,projects(name)")
            .in("session_id", sessionIds)
        : { data: [] as { session_id: string; project_id: string; projects: { name: string } | { name: string }[] | null }[] }

    const projectsBySession: Record<string, string[]> = {}
    for (const link of links ?? []) {
        const proj = Array.isArray(link.projects) ? link.projects[0] : link.projects
        const name = proj && typeof proj === "object" && "name" in proj ? proj.name : ""
        if (!name) continue
        const list = projectsBySession[link.session_id] ?? []
        list.push(name)
        projectsBySession[link.session_id] = list
    }

    return Response.json({ sessions: sessions ?? [], projects, projectsBySession })
}
