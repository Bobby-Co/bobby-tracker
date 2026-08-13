"use client"

import { useState, useTransition } from "react"
import { Spinner } from "@/components/ui/spinner"
import { useApi } from "@/lib/client/hooks/use-api"
import { ApiError, apiMutate } from "@/lib/client/http/api-client"

type McpIntegration = {
    project_id: string
    enabled: boolean
    created_at: string | null
    updated_at: string | null
}

// Integrations-tab toggle for the MCP integration: whether this project's
// indexed knowledge base can be queried by an AI assistant connected over MCP.
// Self-fetching (like GithubSyncPanel) — the tab's server payload doesn't carry
// this row. Off by default; only a team admin/owner can flip it, which the route
// enforces and this panel surfaces as an inline error.
export function McpIntegrationPanel({ projectId }: { projectId: string }) {
    const { data, error: loadError, loading } = useApi<{ integration: McpIntegration | null }>(
        projectId ? `/api/projects/${projectId}/mcp-integration` : null,
    )
    // The switch is DERIVED from the read until a toggle succeeds; `toggled`
    // then holds the confirmed new value. Deriving (rather than syncing state in
    // an effect) keeps the panel to a single render per fetch.
    const [toggled, setToggled] = useState<boolean | null>(null)
    const enabled = toggled ?? !!data?.integration?.enabled
    const [error, setError] = useState<string | null>(null)
    const [pending, startTransition] = useTransition()

    function toggle(next: boolean) {
        setError(null)
        startTransition(async () => {
            try {
                const { integration } = await apiMutate<{ integration?: { enabled?: boolean } }>(
                    `/api/projects/${projectId}/mcp-integration`,
                    { method: "PATCH", body: { enabled: next } },
                )
                setToggled(!!integration?.enabled)
            } catch (e) {
                if (!(e instanceof ApiError)) throw e
                setError(e.message || `Failed (${e.status})`)
            }
        })
    }

    return (
        <div className="rounded-[16px] border border-[color:var(--c-border)] bg-[color:var(--c-surface)] p-4 sm:p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                    <div className="flex items-center gap-2">
                        <div className="text-[14px] font-bold">MCP access</div>
                        {!loading && (
                            <span
                                className={
                                    enabled
                                        ? "rounded-full bg-emerald-100 px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-[0.08em] text-emerald-800"
                                        : "rounded-full bg-[color:var(--c-surface-2)] px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-[0.08em] text-[color:var(--c-text-muted)]"
                                }
                            >
                                {enabled ? "Enabled" : "Disabled"}
                            </span>
                        )}
                    </div>
                    <p className="mt-1 text-[13px] text-[color:var(--c-text-muted)]">
                        Enable so this project&apos;s indexed knowledge base can be queried over MCP by
                        AI assistants such as Claude — they can locate relevant files and ask questions
                        about the codebase. Off by default; only a team admin can change it.
                    </p>
                </div>
                <button
                    type="button"
                    onClick={() => toggle(!enabled)}
                    disabled={loading || pending}
                    className={enabled ? "btn-ghost" : "btn-primary"}
                >
                    {pending
                        ? (<><Spinner />{enabled ? "Disabling…" : "Enabling…"}</>)
                        : (enabled ? "Disable" : "Enable")}
                </button>
            </div>
            {(error || loadError) && (
                <p role="alert" className="mt-3 rounded-[10px] bg-rose-50 px-3 py-2 text-[12.5px] text-rose-800">
                    {error ?? loadError}
                </p>
            )}
        </div>
    )
}
