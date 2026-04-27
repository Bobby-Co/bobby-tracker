import { createClient } from "@/lib/supabase/server"
import { AnalyserPanel } from "@/components/analyser-panel"
import type { ProjectAnalyser } from "@/lib/supabase/types"

export const dynamic = "force-dynamic"

export default async function IntegrationsPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    const supabase = await createClient()
    const { data: state } = await supabase
        .from("project_analyser")
        .select("*")
        .eq("project_id", id)
        .maybeSingle<ProjectAnalyser>()

    return (
        <div className="flex flex-col gap-4">
            <header>
                <h2 className="h-section">Integrations</h2>
                <p className="mt-1 text-[13px] text-[color:var(--c-text-muted)]">
                    Connect this project to bobby-analyser to power smart issue suggestions.
                </p>
            </header>
            <AnalyserPanel projectId={id} state={state ?? null} />

            <div className="card-stack">
                <div className="rounded-[16px] border border-dashed border-[color:var(--c-border)] bg-white p-5 text-[13px] text-[color:var(--c-text-muted)]">
                    <div className="text-[14px] font-bold text-[color:var(--c-text)]">GitHub Issues sync</div>
                    <p className="mt-1">Two-way sync of issues with the linked GitHub repo.</p>
                </div>
            </div>
        </div>
    )
}
