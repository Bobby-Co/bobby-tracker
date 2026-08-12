import { McpConnectPanel } from "@/components/settings/mcp-connect-panel"

// Settings → AI Assistant. How to connect Claude (or any MCP client) to this
// workspace's knowledge bases. Exposure itself is a per-project decision made in
// each project's Integrations tab; this page is the connection side of it.
export default function McpSettingsPage() {
    return (
        <section>
            <h2 className="text-[15px] font-bold tracking-[-0.006em]">AI Assistant</h2>
            <p className="mt-1 text-[13px] text-[color:var(--c-text-muted)]">
                Let Claude query your indexed codebases over{" "}
                <span className="font-semibold text-[color:var(--c-text)]">MCP</span> — so it can find the
                right files without reading through your repository.
            </p>
            <div className="mt-5">
                <McpConnectPanel />
            </div>
        </section>
    )
}
