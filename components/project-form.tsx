"use client"

import { useCallback, useEffect, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import type { GithubRepoSummary } from "@/lib/supabase/types"

// GitHub's per-app authorization page lets the user grant access to
// organizations they skipped at sign-in time (or that an org admin has
// since approved). When NEXT_PUBLIC_GITHUB_CLIENT_ID is set we deep-link
// straight to the app; otherwise we point at the OAuth-apps list and
// let the user find this app by name.
const GH_CLIENT_ID = process.env.NEXT_PUBLIC_GITHUB_CLIENT_ID
const GH_APP_SETTINGS_URL = GH_CLIENT_ID
    ? `https://github.com/settings/connections/applications/${GH_CLIENT_ID}`
    : "https://github.com/settings/applications"

type LoadState =
    | { kind: "loading" }
    | { kind: "needs_reauth"; message: string }
    | { kind: "error"; message: string }
    | { kind: "ready"; repos: GithubRepoSummary[]; truncated: boolean; refreshing: boolean }

async function fetchRepoListState(): Promise<LoadState> {
    const res = await fetch("/api/github/repos", { cache: "no-store" })
    if (res.status === 401) {
        const body = await res.json().catch(() => null)
        return {
            kind: "needs_reauth",
            message: body?.error?.message || "Connect GitHub to list your repositories.",
        }
    }
    if (!res.ok) {
        const body = await res.json().catch(() => null)
        return {
            kind: "error",
            message: body?.error?.message || `Failed to load repositories (${res.status}).`,
        }
    }
    const body = (await res.json()) as { repos: GithubRepoSummary[]; truncated: boolean }
    return { kind: "ready", repos: body.repos, truncated: body.truncated, refreshing: false }
}

export function ProjectForm() {
    const router = useRouter()
    const [name, setName] = useState("")
    const [description, setDescription] = useState("")
    const [selected, setSelected] = useState<GithubRepoSummary | null>(null)
    const [filter, setFilter] = useState("")
    const [load, setLoad] = useState<LoadState>({ kind: "loading" })
    const [error, setError] = useState<string | null>(null)
    const [pending, startTransition] = useTransition()

    useEffect(() => {
        let cancelled = false
        ;(async () => {
            const next = await fetchRepoListState()
            if (!cancelled) setLoad(next)
        })()
        return () => {
            cancelled = true
        }
    }, [])

    const refresh = useCallback(async () => {
        setLoad((prev) =>
            prev.kind === "ready" ? { ...prev, refreshing: true } : { kind: "loading" },
        )
        const next = await fetchRepoListState()
        setLoad(next)
    }, [])

    async function reconnect() {
        const supabase = createClient()
        const base =
            typeof window !== "undefined" && window.location.hostname === "localhost"
                ? `${window.location.protocol}//${window.location.host}`
                : "https://track.bobby.host"
        await supabase.auth.signInWithOAuth({
            provider: "github",
            options: {
                redirectTo: `${base}/auth/callback?next=${encodeURIComponent("/projects/new")}`,
                scopes: "repo read:user user:email",
            },
        })
    }

    function submit(e: React.FormEvent) {
        e.preventDefault()
        setError(null)
        if (!selected) {
            setError("Pick a repository from the list above.")
            return
        }
        startTransition(async () => {
            const res = await fetch("/api/projects", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    name: name || selected.name,
                    repo_url: selected.html_url,
                    repo_full_name: selected.full_name,
                    description,
                }),
            })
            if (!res.ok) {
                const body = await res.json().catch(() => ({}))
                setError(body?.error?.message || `Failed (${res.status})`)
                return
            }
            const { project } = await res.json()
            router.push(`/projects/${project.id}/issues`)
            router.refresh()
        })
    }

    return (
        <form onSubmit={submit} className="flex flex-col gap-3">
            <Field label="GitHub repository">
                <RepoPicker
                    load={load}
                    filter={filter}
                    onFilterChange={setFilter}
                    selected={selected}
                    onSelect={(r) => {
                        setSelected(r)
                        // Auto-fill the project name on first pick so the
                        // common case is one click.
                        if (!name) setName(r.name)
                    }}
                    onReconnect={reconnect}
                    onRefresh={refresh}
                />
            </Field>
            <Field label="Project name">
                <input
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder={selected?.name || "my-project"}
                    className="input"
                />
            </Field>
            <Field label="Description (optional)">
                <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    rows={2}
                    placeholder={selected?.description || "One-liner about what this tracks"}
                    className="input"
                />
            </Field>
            {error && <p className="text-[12.5px] text-rose-700">{error}</p>}
            <div className="flex justify-end gap-2 pt-1">
                <button
                    type="submit"
                    disabled={pending || !selected}
                    className="btn-primary"
                >
                    {pending ? "Creating…" : "Create project"}
                </button>
            </div>
        </form>
    )
}

function RepoPicker({
    load,
    filter,
    onFilterChange,
    selected,
    onSelect,
    onReconnect,
    onRefresh,
}: {
    load: LoadState
    filter: string
    onFilterChange: (s: string) => void
    selected: GithubRepoSummary | null
    onSelect: (r: GithubRepoSummary) => void
    onReconnect: () => void
    onRefresh: () => void
}) {
    if (load.kind === "loading") {
        return <div className="input text-[13px] text-[color:var(--c-text-muted)]">Loading your repositories…</div>
    }
    if (load.kind === "needs_reauth") {
        return (
            <div className="flex flex-col gap-2 rounded-[10px] border border-dashed border-[color:var(--c-border)] bg-[color:var(--c-surface)] p-3">
                <p className="text-[12.5px] text-[color:var(--c-text-muted)]">{load.message}</p>
                <div className="flex flex-wrap items-center gap-2">
                    <button
                        type="button"
                        onClick={onReconnect}
                        className="btn-primary py-1.5 text-[12.5px]"
                    >
                        Connect GitHub
                    </button>
                    <OrgAccessLink />
                </div>
            </div>
        )
    }
    if (load.kind === "error") {
        return <p className="text-[12.5px] text-rose-700">{load.message}</p>
    }
    if (load.kind === "ready" && load.repos.length === 0) {
        return (
            <div className="flex flex-col gap-2">
                <p className="text-[12.5px] text-[color:var(--c-text-muted)]">
                    No repositories visible to your GitHub account.
                </p>
                <OrgAccessFooter onRefresh={onRefresh} refreshing={false} />
            </div>
        )
    }

    const filtered = filter.trim()
        ? load.repos.filter((r) => r.full_name.toLowerCase().includes(filter.trim().toLowerCase()))
        : load.repos
    const visible = filtered.slice(0, 50)

    return (
        <div className="flex flex-col gap-2">
            <input
                autoFocus
                value={filter}
                onChange={(e) => onFilterChange(e.target.value)}
                placeholder={`Search ${load.repos.length}${load.truncated ? "+" : ""} repos…`}
                className="input"
            />
            <div className="max-h-64 overflow-y-auto rounded-[10px] border border-[color:var(--c-border)] bg-white">
                {visible.length === 0 && (
                    <p className="px-3 py-2 text-[12.5px] text-[color:var(--c-text-muted)]">
                        No matches.
                    </p>
                )}
                <ul role="listbox" className="divide-y divide-[color:var(--c-border)]">
                    {visible.map((r) => {
                        const isSelected = selected?.full_name === r.full_name
                        return (
                            <li key={r.full_name}>
                                <button
                                    type="button"
                                    onClick={() => onSelect(r)}
                                    className={`flex w-full items-start justify-between gap-3 px-3 py-2 text-left text-[13px] hover:bg-[color:var(--c-surface)] ${
                                        isSelected ? "bg-[color:var(--c-surface)]" : ""
                                    }`}
                                    role="option"
                                    aria-selected={isSelected}
                                >
                                    <div className="min-w-0 flex-1">
                                        <div className="flex items-center gap-1.5">
                                            <span className="truncate font-medium">{r.full_name}</span>
                                            {r.private && (
                                                <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-900">
                                                    Private
                                                </span>
                                            )}
                                        </div>
                                        {r.description && (
                                            <p className="mt-0.5 truncate text-[11.5px] text-[color:var(--c-text-muted)]">
                                                {r.description}
                                            </p>
                                        )}
                                    </div>
                                    {isSelected && (
                                        <span className="shrink-0 text-[11px] font-bold uppercase tracking-wide text-emerald-700">
                                            ✓ Selected
                                        </span>
                                    )}
                                </button>
                            </li>
                        )
                    })}
                </ul>
            </div>
            {load.truncated && (
                <p className="text-[11px] text-[color:var(--c-text-muted)]">
                    Showing the {load.repos.length} most-recently-updated repos. Filter to find older ones.
                </p>
            )}
            <OrgAccessFooter onRefresh={onRefresh} refreshing={load.refreshing} />
        </div>
    )
}

// Renders below the repo picker. Tells the user where to go on GitHub
// when an organization is missing from the list — re-running OAuth
// rarely re-prompts, so we deep-link straight to GitHub's app-permissions
// page where they can grant additional org access. The Refresh button
// then re-pulls /user/repos so newly-granted orgs show up without a
// page reload.
function OrgAccessFooter({ onRefresh, refreshing }: { onRefresh: () => void; refreshing: boolean }) {
    return (
        <div className="flex flex-wrap items-center justify-between gap-2 text-[11.5px] text-[color:var(--c-text-muted)]">
            <span>
                Missing an organization?{" "}
                <a
                    href={GH_APP_SETTINGS_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium text-[color:var(--c-text)] underline decoration-dotted underline-offset-2 hover:decoration-solid"
                >
                    Grant access on GitHub ↗
                </a>
            </span>
            <button
                type="button"
                onClick={onRefresh}
                disabled={refreshing}
                className="rounded-[8px] border border-[color:var(--c-border)] bg-white px-2 py-1 text-[11.5px] font-medium hover:bg-[color:var(--c-surface)] disabled:opacity-60"
            >
                {refreshing ? "Refreshing…" : "↻ Refresh"}
            </button>
        </div>
    )
}

// Compact inline variant used inside the needs_reauth banner. Same
// destination as OrgAccessFooter; no refresh button (there's nothing
// to refresh until the user reconnects).
function OrgAccessLink() {
    return (
        <a
            href={GH_APP_SETTINGS_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[11.5px] font-medium text-[color:var(--c-text-muted)] underline decoration-dotted underline-offset-2 hover:decoration-solid"
        >
            Manage org access ↗
        </a>
    )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <label className="flex flex-col gap-1">
            <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-[color:var(--c-text-muted)]">
                {label}
            </span>
            {children}
        </label>
    )
}
