import { ConnectionsPanel } from "@/components/settings/connections-panel"

// Settings → Connections. Account-level VCS provider connections (GitHub +
// GitLab). Connecting here is what the add-project repo picker reads from, so a
// user connects once and every connected source shows up when creating projects.
export default function ConnectionsPage() {
    return (
        <section className="max-w-xl">
            <h2 className="text-[15px] font-bold tracking-[-0.006em]">Connections</h2>
            <p className="mt-1 text-[13px] text-[color:var(--c-text-muted)]">
                Connect the version-control providers you want to create projects from. You can
                connect both GitHub and GitLab.
            </p>
            <div className="mt-4">
                <ConnectionsPanel />
            </div>
        </section>
    )
}
