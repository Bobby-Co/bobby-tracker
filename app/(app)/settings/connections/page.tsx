import { ConnectionsPanel } from "@/components/settings/connections-panel"

// Settings → Connections. Account-level VCS provider connections (GitHub +
// GitLab). Connecting here is what the add-project repo picker reads from, so a
// user connects once and every connected source shows up when creating projects.
export default function ConnectionsPage() {
    return (
        <div className="w-full px-5 py-6 sm:px-7 sm:py-7">
            <header>
                <h1 className="text-[22px] font-bold tracking-[-0.012em]">Settings</h1>
                <p className="mt-1 text-[13px] text-[color:var(--c-text-muted)]">
                    Connect the version-control providers you want to create projects from. You can
                    connect both GitHub and GitLab.
                </p>
            </header>
            <section className="mt-6 max-w-xl">
                <h2 className="mb-2 text-[11px] font-bold uppercase tracking-[0.08em] text-[color:var(--c-text-muted)]">
                    Connections
                </h2>
                <ConnectionsPanel />
            </section>
        </div>
    )
}
