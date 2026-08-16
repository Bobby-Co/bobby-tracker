import { ApiContext, jsonError } from "@/lib/server/http/api"

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
export async function GET(request: Request) {
    // Establish the team, then scope the read to it. This previously called
    // requireUser and listAll(), which returns every session in the table — RLS
    // was the only thing narrowing it to the caller's teams. Under a service-role
    // client that read is the entire installation's sessions.
    const { ctx, teamId, error } = await new ApiContext(request).requireTeam()
    if (error) return error

    // Tolerate the table being absent (migration 0009 not yet applied) — surface a
    // distinct code so the UI can render the migration hint rather than error.
    let sessions
    try {
        sessions = await ctx.sessionsAdmin.listForTeam(teamId)
    } catch (e) {
        return jsonError("pending_migration", e instanceof Error ? e.message : "sessions unavailable", 503)
    }

    // Only enabled-integration projects are eligible for new sessions.
    const projects = await ctx.sessionsAdmin.listEligibleProjects(teamId)

    // Project names per session via the junction. One round-trip; we group here
    // so the client just consumes the finished map.
    const links = await ctx.sessionsAdmin.listProjectNamesBySessions(sessions.map((s) => s.id))
    const projectsBySession: Record<string, string[]> = {}
    for (const link of links) {
        const list = projectsBySession[link.session_id] ?? []
        list.push(link.name)
        projectsBySession[link.session_id] = list
    }

    return Response.json({ sessions, projects, projectsBySession })
}
