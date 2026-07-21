import { jsonError, requireProjectAccess } from "@/lib/platform/http/api"
import { importExistingIssues } from "@/modules/vcs"

export const dynamic = "force-dynamic"

// POST /api/projects/[id]/github-sync/import — "hard sync": pull all existing
// GitHub issues into the tracker (idempotent; skips already-linked ones; does
// not auto-analyse). requireUser + an RLS ownership check; the import itself
// runs service-role. Returns { imported, total, skipped }.
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    const { supabase, error } = await requireProjectAccess(id)
    if (error) return error

    // Ownership check — the cookie client only sees the caller's projects.
    const { data: owned } = await supabase
        .from("projects")
        .select("id")
        .eq("id", id)
        .maybeSingle<{ id: string }>()
    if (!owned) return jsonError("not_found", "project not found", 404)

    try {
        const result = await importExistingIssues(id)
        return Response.json(result)
    } catch (err) {
        const e = err as { message?: string }
        return jsonError("import_failed", e?.message ?? "import failed", 500)
    }
}
