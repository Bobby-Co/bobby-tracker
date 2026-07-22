"use client"

import { useCallback, useEffect, useState } from "react"
import { cn } from "@/components/ui/cn"
import { createClient } from "@/lib/client/supabase"
import { ApiError, apiMutate } from "@/lib/client/http/api-client"
import type { GithubSyncDirection } from "@/lib/shared/types"

// GitHub App slug for the install deep-link. Read from a public env at build
// time (mirrors NEXT_PUBLIC_GITHUB_CLIENT_ID in components/projects/project-form.tsx).
// When unset we send the user to the GitHub Apps directory to find "Bobby".
const GH_APP_SLUG = process.env.NEXT_PUBLIC_GITHUB_APP_SLUG

const DIRECTIONS: { val: GithubSyncDirection; label: string }[] = [
    { val: "both", label: "Two-way" },
    { val: "inbound", label: "GitHub → ucelot" },
    { val: "outbound", label: "ucelot → GitHub" },
]

// GithubSyncPanel is the Integrations-tab control for two-way GitHub issue
// sync: connect the App, toggle sync, choose direction, opt into delete
// propagation, and hard-sync existing issues. Reads state directly (RLS-scoped).
export function GithubSyncPanel({ projectId }: { projectId: string }) {
    const [installed, setInstalled] = useState<boolean | null>(null) // null = loading
    const [enabled, setEnabled] = useState(false)
    const [direction, setDirection] = useState<GithubSyncDirection>("both")
    const [deletes, setDeletes] = useState(false)
    const [busy, setBusy] = useState(false)
    const [importing, setImporting] = useState(false)
    const [importMsg, setImportMsg] = useState<string | null>(null)
    const [err, setErr] = useState<string | null>(null)

    // Load current sync state. RLS scopes this to the owner, so a plain
    // client-side select is safe.
    const load = useCallback(async () => {
        const supabase = createClient()
        const { data } = await supabase
            .from("projects")
            .select("github_installation_id,github_sync_enabled,github_sync_direction,github_sync_deletes")
            .eq("id", projectId)
            .maybeSingle<{
                github_installation_id: number | null
                github_sync_enabled: boolean
                github_sync_direction: GithubSyncDirection
                github_sync_deletes: boolean
            }>()
        setInstalled(!!data?.github_installation_id)
        setEnabled(!!data?.github_sync_enabled)
        setDirection(data?.github_sync_direction ?? "both")
        setDeletes(!!data?.github_sync_deletes)
    }, [projectId])

    useEffect(() => {
        // load() only sets state after an awaited fetch (not synchronously).
        void (async () => {
            await load()
        })()
    }, [load])

    // The install link carries state=<projectId> so the callback knows which
    // project to link once GitHub returns the user.
    const installUrl = GH_APP_SLUG
        ? `https://github.com/apps/${GH_APP_SLUG}/installations/new?state=${encodeURIComponent(projectId)}`
        : "https://github.com/apps"

    // Connect: try to link an already-installed app directly (no redirect). If
    // the app isn't on the repo yet, fall through to GitHub's install flow.
    async function connect() {
        setErr(null)
        setBusy(true)
        try {
            const data = await apiMutate<{ installed?: boolean; linked?: boolean }>(
                `/api/projects/${projectId}/github-sync/link`,
                { method: "POST" },
            )
            if (data?.installed && data?.linked) {
                await load()
                return
            }
            // App not installed on the repo yet → send the user to install it.
            window.location.href = installUrl
        } catch (e) {
            if (e instanceof ApiError) setErr(e.message || `Failed (${e.status})`)
            else setErr("Network error")
        } finally {
            setBusy(false)
        }
    }

    // saveSetting POSTs a partial settings patch (enabled / direction / deletes)
    // and reconciles local state from the response. Reverts by reloading on error.
    async function saveSetting(patch: { enabled?: boolean; direction?: GithubSyncDirection; deletes?: boolean }) {
        setErr(null)
        setBusy(true)
        // Optimistic.
        if (patch.enabled !== undefined) setEnabled(patch.enabled)
        if (patch.direction !== undefined) setDirection(patch.direction)
        if (patch.deletes !== undefined) setDeletes(patch.deletes)
        try {
            const data = await apiMutate<{
                project?: {
                    github_sync_enabled: boolean
                    github_sync_direction: GithubSyncDirection
                    github_sync_deletes: boolean
                }
            }>(`/api/projects/${projectId}/github-sync`, { method: "POST", body: patch })
            if (data?.project) {
                setEnabled(data.project.github_sync_enabled)
                setDirection(data.project.github_sync_direction)
                setDeletes(data.project.github_sync_deletes)
            }
        } catch (e) {
            if (e instanceof ApiError) setErr(e.message || `Failed (${e.status})`)
            else setErr("Network error")
            await load()
        } finally {
            setBusy(false)
        }
    }

    // importIssues pulls all existing GitHub issues into the tracker (hard sync).
    async function importIssues() {
        setErr(null)
        setImportMsg(null)
        setImporting(true)
        try {
            const data = await apiMutate<{ imported?: number; total?: number; skipped?: number }>(
                `/api/projects/${projectId}/github-sync/import`,
                { method: "POST" },
            )
            setImportMsg(
                `Imported ${data?.imported ?? 0} of ${data?.total ?? 0} issue(s)` +
                    (data?.skipped ? ` · ${data.skipped} already synced` : ""),
            )
        } catch (e) {
            if (e instanceof ApiError) setErr(e.message || `Import failed (${e.status})`)
            else setErr("Network error")
        } finally {
            setImporting(false)
        }
    }

    return (
        <div className="rounded-[16px] border border-[color:var(--c-border)] bg-white p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex items-center gap-2">
                    <GithubIcon />
                    <div className="text-[14px] font-bold">GitHub Issues sync</div>
                </div>
                {installed === null ? null : installed ? (
                    <button
                        type="button"
                        onClick={() => saveSetting({ enabled: !enabled })}
                        disabled={busy}
                        className={cn("px-3 py-1.5 text-[12px]", enabled ? "btn-ghost" : "btn-primary")}
                    >
                        {enabled ? "Disable sync" : "Enable sync"}
                    </button>
                ) : (
                    <button
                        type="button"
                        onClick={connect}
                        disabled={busy}
                        className="btn-primary px-3 py-1.5 text-[12px]"
                    >
                        {busy ? "Connecting…" : "Connect GitHub App"}
                    </button>
                )}
            </div>
            <p className="mt-1 text-[13px] text-[color:var(--c-text-muted)]">
                Mirror issues between this project and its GitHub repo — Bobby also posts its
                analysis as a comment on each issue.
            </p>

            {installed && enabled && (
                <div className="mt-3 border-t border-[color:var(--c-border)] pt-3">
                    <div className="text-[11px] font-bold uppercase tracking-[0.08em] text-[color:var(--c-text-dim)]">
                        Direction
                    </div>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {DIRECTIONS.map(({ val, label }) => (
                            <button
                                key={val}
                                type="button"
                                disabled={busy}
                                onClick={() => saveSetting({ direction: val })}
                                className={cn(
                                    "rounded-full border px-3 py-1 text-[12px]",
                                    direction === val
                                        ? "btn-primary border-transparent"
                                        : "border-[color:var(--c-border)] text-[color:var(--c-text-muted)]",
                                )}
                            >
                                {label}
                            </button>
                        ))}
                    </div>

                    <label className="mt-3 flex items-center gap-2 text-[12.5px] text-[color:var(--c-text-muted)]">
                        <input
                            type="checkbox"
                            checked={deletes}
                            disabled={busy}
                            onChange={(e) => saveSetting({ deletes: e.target.checked })}
                        />
                        Also sync deletions{" "}
                        <span className="text-[color:var(--c-text-dim)]">(delete here → delete/close on GitHub)</span>
                    </label>

                    <div className="mt-3 flex flex-wrap items-center gap-2">
                        <button
                            type="button"
                            onClick={importIssues}
                            disabled={importing || direction === "outbound"}
                            className="btn-ghost px-3 py-1.5 text-[12px]"
                        >
                            {importing ? "Importing…" : "Import existing issues"}
                        </button>
                        {direction === "outbound" && (
                            <span className="text-[11.5px] text-[color:var(--c-text-dim)]">
                                Import needs an inbound direction.
                            </span>
                        )}
                    </div>
                    {importMsg && <p className="mt-2 text-[12px] text-emerald-700">{importMsg}</p>}
                </div>
            )}

            {installed && (
                <p className="mt-2 text-[11.5px] text-[color:var(--c-text-dim)]">
                    App connected · sync {enabled ? "on" : "off"}
                </p>
            )}
            {err && <p className="mt-2 text-[12px] text-rose-700">{err}</p>}
        </div>
    )
}

function GithubIcon() {
    return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" className="text-[color:var(--c-text-muted)]" aria-hidden>
            <path d="M12 2C6.48 2 2 6.58 2 12.25c0 4.53 2.87 8.37 6.84 9.73.5.1.68-.22.68-.49 0-.24-.01-.87-.01-1.71-2.78.62-3.37-1.22-3.37-1.22-.46-1.18-1.11-1.5-1.11-1.5-.91-.63.07-.62.07-.62 1 .07 1.53 1.06 1.53 1.06.89 1.56 2.34 1.11 2.91.85.09-.66.35-1.11.63-1.36-2.22-.26-4.56-1.14-4.56-5.06 0-1.12.39-2.03 1.03-2.75-.1-.26-.45-1.3.1-2.71 0 0 .84-.28 2.75 1.05a9.36 9.36 0 0 1 2.5-.34c.85 0 1.71.12 2.5.34 1.91-1.33 2.75-1.05 2.75-1.05.55 1.41.2 2.45.1 2.71.64.72 1.03 1.63 1.03 2.75 0 3.93-2.34 4.79-4.57 5.05.36.32.68.94.68 1.9 0 1.37-.01 2.47-.01 2.81 0 .27.18.6.69.49A10.02 10.02 0 0 0 22 12.25C22 6.58 17.52 2 12 2z" />
        </svg>
    )
}
