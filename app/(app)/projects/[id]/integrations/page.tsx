import { createClient } from "@/lib/supabase/server"
import type { ProjectPublicSession } from "@/lib/supabase/types"
import { PublicSessionPanel } from "@/components/public-session-panel"

export const dynamic = "force-dynamic"

// Integrations tab — external-service syncs (GitHub Issues, Linear,
// etc.) and shareable submission surfaces. The analyser panels
// (indexing + graph health) live on the dedicated Knowledge tab.
export default async function IntegrationsPage({
    params,
}: {
    params: Promise<{ id: string }>
}) {
    const { id } = await params
    const supabase = await createClient()
    const { data: session } = await supabase
        .from("project_public_sessions")
        .select("*")
        .eq("project_id", id)
        .maybeSingle<ProjectPublicSession>()

    return (
        <div className="flex flex-col gap-4">
            <header>
                <h2 className="h-section">Integrations</h2>
                <p className="mt-1 text-[13px] text-[color:var(--c-text-muted)]">
                    Connect this project to external services and share submission surfaces.
                </p>
            </header>

            <div className="card-stack flex flex-col gap-4">
                <PublicSessionPanel projectId={id} initialSession={session ?? null} />

                <div className="rounded-[16px] border border-dashed border-[color:var(--c-border)] bg-white p-5 text-[13px] text-[color:var(--c-text-muted)]">
                    <div className="text-[14px] font-bold text-[color:var(--c-text)]">GitHub Issues sync</div>
                    <p className="mt-1">Two-way sync of issues with the linked GitHub repo.</p>
                </div>
            </div>
        </div>
    )
}
