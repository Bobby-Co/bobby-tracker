"use client"

import { useEffect, useState, useTransition } from "react"
import { Spinner } from "@/components/ui/spinner"
import { useApi } from "@/lib/client/hooks/use-api"
import { ApiError, apiMutate } from "@/lib/client/http/api-client"

type Connection = {
    id: string
    clientId: string
    clientName: string
    scope: string
    expiresAt: string
    lastUsedAt: string | null
    createdAt: string
}

// Settings → AI Assistant. Everything a user needs to point Claude at their own
// knowledge bases: the endpoint, the one-line CLI command, and what will happen
// when they connect (a browser consent step, then only the projects they've
// explicitly exposed).
//
// The base URL is resolved on the client from the current origin, falling back to
// the configured app URL. Reading the live origin means the copied command is
// correct in every environment without a second place to keep in sync.

const TOOLS = [
    {
        name: "locate_files",
        blurb: "Finds the files behind a feature or bug and returns the exact file:line snippets — so Claude reads two files instead of twenty.",
    },
    { name: "ask_codebase", blurb: "Answers “how does this work?” about an indexed project, with citations." },
    { name: "list_knowledge_bases", blurb: "Lists the projects you've exposed, so Claude can pick the right one." },
]

function CopyRow({ label, value }: { label: string; value: string }) {
    const [copied, setCopied] = useState(false)

    useEffect(() => {
        if (!copied) return
        const t = setTimeout(() => setCopied(false), 1600)
        return () => clearTimeout(t)
    }, [copied])

    async function copy() {
        try {
            await navigator.clipboard.writeText(value)
            setCopied(true)
        } catch {
            // Clipboard blocked (insecure context / denied permission) — the value
            // is on screen and selectable, so this is a non-event.
        }
    }

    return (
        <div className="mt-3">
            <div className="text-[12px] font-semibold text-[color:var(--c-text-muted)]">{label}</div>
            <div className="mt-1 flex items-stretch gap-2">
                <code className="min-w-0 flex-1 overflow-x-auto whitespace-pre rounded-[10px] bg-zinc-50 px-3 py-2 text-[12.5px] text-[color:var(--c-text)]">
                    {value}
                </code>
                <button type="button" onClick={copy} className="btn-ghost shrink-0">
                    {copied ? "Copied" : "Copy"}
                </button>
            </div>
        </div>
    )
}

function relativeTime(iso: string | null): string {
    if (!iso) return "never"
    const seconds = Math.round((Date.now() - Date.parse(iso)) / 1000)
    if (!Number.isFinite(seconds)) return "unknown"
    if (seconds < 60) return "just now"
    const units: [number, string][] = [
        [60, "minute"],
        [24, "hour"],
        [7, "day"],
    ]
    let value = seconds / 60
    let unit = "minute"
    for (const [step, name] of units) {
        if (value < step) break
        value /= step
        unit = name === "minute" ? "hour" : name === "hour" ? "day" : "week"
    }
    const rounded = Math.floor(value)
    return `${rounded} ${unit}${rounded === 1 ? "" : "s"} ago`
}

/** The assistants currently holding a live token, with a way to cut them off.
 *  Revoking takes effect on the next call — the MCP endpoint re-checks the token
 *  against the database on every request. */
function ConnectionsCard() {
    const { data, error: loadError, loading, refetch } = useApi<{ connections: Connection[] }>("/api/mcp/connections")
    // Revoked ids are hidden optimistically so the row disappears immediately,
    // even before the refetch lands.
    const [revoked, setRevoked] = useState<string[]>([])
    const [error, setError] = useState<string | null>(null)
    const [pending, startTransition] = useTransition()

    const connections = (data?.connections ?? []).filter((c) => !revoked.includes(c.id))

    function revoke(id: string) {
        setError(null)
        startTransition(async () => {
            try {
                await apiMutate(`/api/mcp/connections/${id}`, { method: "DELETE" })
                setRevoked((prev) => [...prev, id])
                refetch?.()
            } catch (e) {
                if (!(e instanceof ApiError)) throw e
                setError(e.message || `Failed (${e.status})`)
            }
        })
    }

    return (
        <div className="rounded-[16px] border border-[color:var(--c-border)] bg-white p-4 sm:p-5">
            <div className="text-[14px] font-bold">Connected assistants</div>
            {loading && <p className="mt-2 text-[13px] text-[color:var(--c-text-muted)]">Loading…</p>}

            {!loading && connections.length === 0 && (
                <p className="mt-1 text-[13px] text-[color:var(--c-text-muted)]">
                    Nothing is connected yet. Follow the steps above, and the assistant will appear here once
                    you approve it.
                </p>
            )}

            {connections.length > 0 && (
                <ul className="mt-3 divide-y divide-[color:var(--c-border)]">
                    {connections.map((c) => (
                        <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
                            <div className="min-w-0">
                                <div className="text-[13px] font-semibold">{c.clientName}</div>
                                <div className="text-[12px] text-[color:var(--c-text-muted)]">
                                    Last used {relativeTime(c.lastUsedAt)} · {c.scope}
                                </div>
                            </div>
                            <button
                                type="button"
                                onClick={() => revoke(c.id)}
                                disabled={pending}
                                className="btn-ghost shrink-0"
                            >
                                {pending ? <Spinner /> : null}
                                Revoke
                            </button>
                        </li>
                    ))}
                </ul>
            )}

            {(error || loadError) && (
                <p role="alert" className="mt-3 rounded-[10px] bg-rose-50 px-3 py-2 text-[12.5px] text-rose-800">
                    {error ?? loadError}
                </p>
            )}
        </div>
    )
}

export function McpConnectPanel() {
    // Deliberately the CONFIGURED app URL, not window.location.origin. The OAuth
    // documents derive the canonical resource identifier from this same value, and
    // a token is bound to that resource — so an endpoint copied from whatever
    // hostname the user happens to be browsing could fail to match. One source of
    // truth keeps the copied command and the issued token in agreement.
    const origin = (process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/+$/, "")
    // /mcp, not /api/mcp — the same server, but this is the address we advertise.
    // See app/mcp/route.ts for why the second address exists.
    const endpoint = `${origin}/mcp`

    return (
        <div className="space-y-4">
            <div className="rounded-[16px] border border-[color:var(--c-border)] bg-white p-4 sm:p-5">
                <div className="text-[14px] font-bold">Connect Claude to your knowledge bases</div>
                <p className="mt-1 text-[13px] text-[color:var(--c-text-muted)]">
                    Ucelot exposes your indexed codebases over MCP. Once connected, Claude can ask where
                    something lives and get the exact files and line numbers back — instead of searching
                    through your repository and reading files to find out.
                </p>

                <CopyRow label="MCP server URL" value={endpoint} />
                <CopyRow label="Claude Code" value={`claude mcp add --transport http ucelot ${endpoint}`} />

                <p className="mt-4 text-[13px] text-[color:var(--c-text-muted)]">
                    For Claude Desktop or claude.ai, go to <strong>Settings → Connectors → Add custom
                    connector</strong> and paste the server URL above.
                </p>
                <p className="mt-2 text-[13px] text-[color:var(--c-text-muted)]">
                    The first call opens your browser to sign in and approve access. Claude never receives
                    your password — only a token you can revoke here at any time.
                </p>
            </div>

            <div className="rounded-[16px] border border-[color:var(--c-border)] bg-white p-4 sm:p-5">
                <div className="text-[14px] font-bold">What Claude can do</div>
                <ul className="mt-2 space-y-2">
                    {TOOLS.map((t) => (
                        <li key={t.name} className="text-[13px]">
                            <code className="rounded bg-zinc-100 px-1.5 py-0.5 text-[12px] font-semibold">{t.name}</code>
                            <span className="ml-2 text-[color:var(--c-text-muted)]">{t.blurb}</span>
                        </li>
                    ))}
                </ul>
                <p className="mt-3 rounded-[10px] bg-amber-50 px-3 py-2 text-[12.5px] text-amber-900">
                    Only projects with <strong>MCP access</strong> enabled are visible — turn it on per project
                    in that project&apos;s <strong>Integrations</strong> tab. Everything else stays private.
                </p>
            </div>

            <ConnectionsCard />
        </div>
    )
}
