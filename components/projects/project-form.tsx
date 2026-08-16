"use client"

import { useCallback, useEffect, useState, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { ApiError, apiMutate } from "@/lib/client/http/api-client"
import type { GithubRepoSummary } from "@/lib/shared/types"
import { IconlyGithub } from "@/icons/Iconly-github-icon"
import { IconlyGitlab } from "@/icons/Iconly-gitlab-icon"

// A provider-neutral repo row for the unified picker. GitHub and GitLab repos
// (across every connected instance) are normalized into this shape and shown in
// one list, each tagged with its source.
interface PickerRepo {
    provider: "github" | "gitlab"
    host: string
    full_name: string
    name: string
    description: string | null
    private: boolean
    html_url: string
    external_id: number | null // GitLab project id; null for GitHub
}


interface GitlabRepo {
    provider: "gitlab"
    host: string
    external_id: number
    full_name: string
    name: string
    description: string | null
    private: boolean
    html_url: string
}

type LoadState =
    | { kind: "loading" }
    | {
          kind: "ready"
          repos: PickerRepo[]
          truncated: boolean
          anyConnected: boolean
          warnings: string[]
          refreshing: boolean
      }
    | { kind: "error"; message: string }

// Pull repos from every connected source in parallel. A provider that isn't
// connected (GitHub 401, or no GitLab instances) just contributes nothing —
// connecting is done in Settings → Connections, not here.
async function fetchRepoListState(): Promise<LoadState> {
    const [gh, gl] = await Promise.allSettled([
        fetch("/api/github/repos", { cache: "no-store" }),
        fetch("/api/gitlab/repos", { cache: "no-store" }),
    ])

    const repos: PickerRepo[] = []
    const warnings: string[] = []
    let githubConnected = false
    let gitlabConnected = false
    let truncated = false

    if (gh.status === "fulfilled") {
        if (gh.value.ok) {
            githubConnected = true
            const body = (await gh.value.json()) as { repos: GithubRepoSummary[]; truncated: boolean }
            truncated = truncated || body.truncated
            for (const r of body.repos) {
                repos.push({
                    provider: "github",
                    host: "github.com",
                    full_name: r.full_name,
                    name: r.name,
                    description: r.description,
                    private: r.private,
                    html_url: r.html_url,
                    external_id: null,
                })
            }
        }
        // 401 = GitHub not connected; silently contribute nothing.
    }

    if (gl.status === "fulfilled" && gl.value.ok) {
        const body = (await gl.value.json()) as {
            repos: GitlabRepo[]
            errors: { host: string; reason: string }[]
        }
        gitlabConnected = body.repos.length > 0 || body.errors.length > 0
        for (const r of body.repos) {
            repos.push({
                provider: "gitlab",
                host: r.host,
                full_name: r.full_name,
                name: r.name,
                description: r.description,
                private: r.private,
                html_url: r.html_url,
                external_id: r.external_id,
            })
        }
        for (const e of body.errors) {
            warnings.push(
                e.reason === "reauth"
                    ? `${e.host}: reconnect in Settings — the token expired or was revoked.`
                    : `${e.host}: couldn't load repos (${e.reason}).`,
            )
        }
    }

    return {
        kind: "ready",
        repos,
        truncated,
        anyConnected: githubConnected || gitlabConnected,
        warnings,
        refreshing: false,
    }
}

export function ProjectForm() {
    const router = useRouter()
    const [name, setName] = useState("")
    const [description, setDescription] = useState("")
    const [selected, setSelected] = useState<PickerRepo | null>(null)
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
        setLoad((prev) => (prev.kind === "ready" ? { ...prev, refreshing: true } : { kind: "loading" }))
        setLoad(await fetchRepoListState())
    }, [])

    function submit(e: React.FormEvent) {
        e.preventDefault()
        setError(null)
        if (!selected) {
            setError("Pick a repository from the list above.")
            return
        }
        startTransition(async () => {
            try {
                const { project } = await apiMutate<{ project: { id: string } }>("/api/projects", {
                    method: "POST",
                    body: {
                        name: name || selected.name,
                        repo_url: selected.html_url,
                        repo_full_name: selected.full_name,
                        description,
                        provider: selected.provider,
                        ...(selected.provider === "gitlab"
                            ? { gitlab_project_id: selected.external_id }
                            : {}),
                    },
                })
                router.push(`/projects/${project.id}/setup`)
                router.refresh()
            } catch (e) {
                if (!(e instanceof ApiError)) throw e
                setError(e.message || `Failed (${e.status})`)
            }
        })
    }

    return (
        <form onSubmit={submit} className="flex flex-col gap-3">
            <Field label="Repository">
                <RepoPicker
                    load={load}
                    filter={filter}
                    onFilterChange={setFilter}
                    selected={selected}
                    onSelect={(r) => {
                        setSelected(r)
                        if (!name) setName(r.name)
                    }}
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
                <button type="submit" disabled={pending || !selected} className="btn-primary">
                    {pending ? "Creating…" : "Create project"}
                </button>
            </div>
        </form>
    )
}

// The small GitHub/GitLab mark shown on every row so the source is unambiguous.
function ProviderIcon({ provider }: { provider: "github" | "gitlab" }) {
    return (
        <span
            title={provider === "github" ? "GitHub" : "GitLab"}
            className="grid h-4 w-4 shrink-0 place-items-center text-[color:var(--c-text-muted)]"
        >
            {provider === "github" ? <IconlyGithub size={14} /> : <IconlyGitlab size={14} />}
        </span>
    )
}

function RepoPicker({
    load,
    filter,
    onFilterChange,
    selected,
    onSelect,
    onRefresh,
}: {
    load: LoadState
    filter: string
    onFilterChange: (s: string) => void
    selected: PickerRepo | null
    onSelect: (r: PickerRepo) => void
    onRefresh: () => void
}) {
    if (load.kind === "loading") {
        return <div className="input text-[13px] text-[color:var(--c-text-muted)]">Loading your repositories…</div>
    }
    if (load.kind === "error") {
        return <p className="text-[12.5px] text-rose-700">{load.message}</p>
    }
    // Nothing connected → send the user to Settings (this form only lists).
    if (!load.anyConnected) {
        return (
            <div className="flex flex-col gap-2 rounded-[10px] border border-dashed border-[color:var(--c-border)] bg-[color:var(--c-surface)] p-3">
                <p className="text-[12.5px] text-[color:var(--c-text-muted)]">
                    Connect GitHub or GitLab to list your repositories.
                </p>
                <Link href="/settings/connections" className="btn-primary self-start py-1.5 text-[12.5px]">
                    Go to Connections
                </Link>
            </div>
        )
    }

    const q = filter.trim().toLowerCase()
    const filtered = q ? load.repos.filter((r) => r.full_name.toLowerCase().includes(q)) : load.repos
    const visible = filtered.slice(0, 50)

    return (
        <div className="flex flex-col gap-2">
            {load.warnings.length > 0 && (
                <div className="rounded-[10px] border border-amber-200 bg-amber-50 px-3 py-2 text-[11.5px] text-amber-900">
                    {load.warnings.map((w, i) => (
                        <div key={i}>{w}</div>
                    ))}
                </div>
            )}
            <input
                autoFocus
                value={filter}
                onChange={(e) => onFilterChange(e.target.value)}
                placeholder={`Search ${load.repos.length}${load.truncated ? "+" : ""} repos…`}
                className="input"
            />
            <div className="max-h-64 overflow-y-auto rounded-[10px] border border-[color:var(--c-border)] bg-[color:var(--c-surface)]">
                {visible.length === 0 && (
                    <p className="px-3 py-2 text-[12.5px] text-[color:var(--c-text-muted)]">No matches.</p>
                )}
                <ul role="listbox" className="divide-y divide-[color:var(--c-border)]">
                    {visible.map((r) => {
                        const key = `${r.provider}:${r.host}:${r.full_name}`
                        const isSelected =
                            selected?.provider === r.provider &&
                            selected?.host === r.host &&
                            selected?.full_name === r.full_name
                        return (
                            <li key={key}>
                                <button
                                    type="button"
                                    onClick={() => onSelect(r)}
                                    className={`flex w-full items-start justify-between gap-3 px-3 py-2 text-left text-[13px] hover:bg-[color:var(--c-surface)] ${
                                        isSelected ? "bg-[color:var(--c-surface)]" : ""
                                    }`}
                                    role="option"
                                    aria-selected={isSelected}
                                >
                                    <div className="flex min-w-0 flex-1 items-start gap-2">
                                        <span className="mt-0.5">
                                            <ProviderIcon provider={r.provider} />
                                        </span>
                                        <div className="min-w-0 flex-1">
                                            <div className="flex items-center gap-1.5">
                                                <span className="truncate font-medium">{r.full_name}</span>
                                                {r.private && (
                                                    <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-900">
                                                        Private
                                                    </span>
                                                )}
                                            </div>
                                            {/* self-managed GitLab host, so identical paths on
                                                different instances are distinguishable */}
                                            {r.provider === "gitlab" && r.host !== "gitlab.com" && (
                                                <p className="truncate text-[11px] text-[color:var(--c-text-muted)]">
                                                    {r.host}
                                                </p>
                                            )}
                                            {r.description && (
                                                <p className="mt-0.5 truncate text-[11.5px] text-[color:var(--c-text-muted)]">
                                                    {r.description}
                                                </p>
                                            )}
                                        </div>
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
            <div className="flex flex-wrap items-center justify-between gap-2 text-[11.5px] text-[color:var(--c-text-muted)]">
                <Link
                    href="/settings/connections"
                    className="font-medium underline decoration-dotted underline-offset-2 hover:text-[color:var(--c-text)]"
                >
                    Manage connections ↗
                </Link>
                <button
                    type="button"
                    onClick={onRefresh}
                    disabled={load.refreshing}
                    className="rounded-[8px] border border-[color:var(--c-border)] bg-[color:var(--c-surface)] px-2 py-1 text-[11.5px] font-medium hover:bg-[color:var(--c-surface)] disabled:opacity-60"
                >
                    {load.refreshing ? "Refreshing…" : "↻ Refresh"}
                </button>
            </div>
        </div>
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
