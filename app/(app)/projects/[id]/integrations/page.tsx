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
    // Tolerate the table being absent (migration 0007 not yet applied) —
    // we'd rather render the page with a "needs migration" hint than 500.
    const { data: session, error: sessionErr } = await supabase
        .from("project_public_sessions")
        .select("*")
        .eq("project_id", id)
        .maybeSingle<ProjectPublicSession>()
    const tableMissing = !!sessionErr

    return (
        <div className="flex flex-col gap-4">
            <header>
                <h2 className="h-section">Integrations</h2>
                <p className="mt-1 text-[13px] text-[color:var(--c-text-muted)]">
                    Connect this project to external services and share submission surfaces.
                </p>
            </header>

            <div className="card-stack flex flex-col gap-4">
                {tableMissing ? (
                    <div className="rounded-[16px] border border-dashed border-amber-300 bg-amber-50 p-5 text-[13px] text-amber-900">
                        <div className="text-[14px] font-bold">Public issue session — pending migration</div>
                        <p className="mt-1">
                            Apply <code className="font-mono">supabase/migrations/0007_public_session.sql</code> (e.g. via{" "}
                            <code className="font-mono">supabase db push</code> or the SQL editor) to enable shareable submission links.
                        </p>
                    </div>
                ) : (
                    <PublicSessionPanel projectId={id} initialSession={session ?? null} />
                )}

                <div className="rounded-[16px] border border-dashed border-[color:var(--c-border)] bg-white p-5 text-[13px] text-[color:var(--c-text-muted)]">
                    <div className="text-[14px] font-bold text-[color:var(--c-text)]">GitHub Issues sync</div>
                    <p className="mt-1">Two-way sync of issues with the linked GitHub repo.</p>
                </div>
            </div>
        </div>
    )
}
