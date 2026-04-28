export const dynamic = "force-dynamic"

// Integrations tab — external-service syncs (GitHub Issues, Linear,
// etc.). The analyser panels (indexing + graph health) used to live
// here; they've moved to the dedicated Knowledge tab so this stays
// focused on third-party hooks rather than internal-graph state.
export default async function IntegrationsPage() {
    return (
        <div className="flex flex-col gap-4">
            <header>
                <h2 className="h-section">Integrations</h2>
                <p className="mt-1 text-[13px] text-[color:var(--c-text-muted)]">
                    Connect this project to external services. (Indexing + graph health moved to the Knowledge tab.)
                </p>
            </header>

            <div className="card-stack">
                <div className="rounded-[16px] border border-dashed border-[color:var(--c-border)] bg-white p-5 text-[13px] text-[color:var(--c-text-muted)]">
                    <div className="text-[14px] font-bold text-[color:var(--c-text)]">GitHub Issues sync</div>
                    <p className="mt-1">Two-way sync of issues with the linked GitHub repo.</p>
                </div>
            </div>
        </div>
    )
}
