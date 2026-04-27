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
                <h2 className="text-sm font-medium uppercase tracking-wider text-zinc-500">Integrations</h2>
                <p className="mt-1 text-sm text-zinc-500">
                    Connect this project to bobby-analyser to power smart issue suggestions.
                </p>
            </header>
            <AnalyserPanel projectId={id} state={state ?? null} />

            <div className="rounded-xl border border-dashed border-zinc-200 bg-white p-5 text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-950">
                <span className="font-medium text-zinc-700 dark:text-zinc-300">GitHub Issues sync</span>
                <span className="ml-2 rounded-md bg-zinc-100 px-1.5 py-0.5 text-[11px] dark:bg-zinc-900">Phase 3</span>
                <p className="mt-1">Two-way sync of issues with the linked GitHub repo.</p>
            </div>
        </div>
    )
}
