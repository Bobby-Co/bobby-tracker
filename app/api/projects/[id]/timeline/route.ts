import { jsonError, requireUser } from "@/lib/api"
import type {
    Issue,
    Project,
    ProjectLabelIcon,
    ProjectStatusColor,
} from "@/lib/supabase/types"

// GET /api/projects/[id]/timeline — everything the planning timeline
// needs in one round-trip: the project's identity, its issues (newest
// first), and the per-project label-icon + status-color overrides.
// `project` is null when the id doesn't resolve so the client can 404.
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    const { supabase, error } = await requireUser()
    if (error) return error

    const [{ data: project }, { data: issues }, { data: labelIcons }, { data: statusColors }] = await Promise.all([
        supabase
            .from("projects")
            .select("id,name,repo_url,repo_full_name")
            .eq("id", id)
            .maybeSingle<Pick<Project, "id" | "name" | "repo_url" | "repo_full_name">>(),
        supabase
            .from("issues")
            .select("*")
            .eq("project_id", id)
            .order("updated_at", { ascending: false })
            .limit(1000) // safety cap; realistic projects are well under this
            .returns<Issue[]>(),
        supabase
            .from("project_label_icons")
            .select("*")
            .eq("project_id", id)
            .returns<ProjectLabelIcon[]>(),
        supabase
            .from("project_status_colors")
            .select("*")
            .eq("project_id", id)
            .returns<ProjectStatusColor[]>(),
    ])

    return Response.json({
        project: project ?? null,
        issues: issues ?? [],
        labelIcons: labelIcons ?? [],
        statusColors: statusColors ?? [],
    })
}
