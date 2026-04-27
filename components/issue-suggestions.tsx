"use client"

import { useState, useTransition } from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { blobUrl, type RepoRef } from "@/lib/github"
import type { IssueSuggestion } from "@/lib/supabase/types"

interface Props {
    issueId: string
    repo: RepoRef
    indexedSha: string | null
    initial: IssueSuggestion | null
    analyserReady: boolean
}

export function IssueSuggestions({ issueId, repo, indexedSha, initial, analyserReady }: Props) {
    const [suggestion, setSuggestion] = useState<IssueSuggestion | null>(initial)
    const [error, setError] = useState<string | null>(null)
    const [errorCode, setErrorCode] = useState<string | null>(null)
    const [pending, startTransition] = useTransition()

    function regenerate() {
        setError(null)
        setErrorCode(null)
        startTransition(async () => {
            const res = await fetch(`/api/issues/${issueId}/suggest`, { method: "POST" })
            if (!res.ok) {
                const body = await res.json().catch(() => ({}))
                setError(body?.error?.message || `Failed (${res.status})`)
                setErrorCode(body?.error?.code || "unknown")
                return
            }
            const { suggestion: next } = await res.json()
            setSuggestion(next)
        })
    }

    return (
        <section className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
            <div className="flex items-start justify-between gap-3">
                <div>
                    <h2 className="flex items-center gap-2 text-sm font-medium">
                        <SparklesIcon />
                        Investigate with analyser
                    </h2>
                    <p className="mt-0.5 text-xs text-zinc-500">
                        {suggestion
                            ? <>Cached {timeAgo(suggestion.created_at)} · ${Number(suggestion.cost_usd ?? 0).toFixed(4)}</>
                            : "Ask the indexed graph which files and lines to look at first."}
                    </p>
                </div>
                <button
                    onClick={regenerate}
                    disabled={pending || !analyserReady}
                    className="btn-primary"
                    title={!analyserReady ? "Enable and index the project first" : undefined}
                >
                    {pending ? "Investigating…" : suggestion ? "Regenerate" : "Investigate"}
                </button>
            </div>

            {!analyserReady && !suggestion && (
                <NeedsIndexing />
            )}

            {error && (
                <div className="mt-3 rounded-lg bg-red-50 p-3 text-xs text-red-800 dark:bg-red-950/40 dark:text-red-300">
                    {errorCode === "needs_indexing" ? <NeedsIndexing /> : <p>{error}</p>}
                </div>
            )}

            {suggestion && <SuggestionBody suggestion={suggestion} repo={repo} indexedSha={indexedSha} />}
        </section>
    )
}

function SuggestionBody({
    suggestion,
    repo,
    indexedSha,
}: {
    suggestion: IssueSuggestion
    repo: RepoRef
    indexedSha: string | null
}) {
    return (
        <div className="mt-4 flex flex-col gap-4">
            {suggestion.code_cites.length > 0 && (
                <div className="flex flex-col gap-1.5">
                    <div className="text-[11px] font-medium uppercase tracking-wider text-zinc-500">
                        Files to investigate
                    </div>
                    <ul className="flex flex-col gap-1.5">
                        {suggestion.code_cites.map((c, i) => (
                            <li key={`${c.file}:${c.line ?? ""}:${i}`}>
                                <CitationLink file={c.file} line={c.line} repo={repo} sha={indexedSha} />
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            <article className="prose-tracker">
                <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={{
                        a: (props) => <a {...props} target="_blank" rel="noreferrer" />,
                        code: ({ className, children, ...rest }) => {
                            const inline = !/language-/.test(className ?? "")
                            if (inline) {
                                return (
                                    <code className="rounded bg-zinc-100 px-1 py-0.5 font-mono text-[12px] dark:bg-zinc-800" {...rest}>
                                        {children}
                                    </code>
                                )
                            }
                            return (
                                <code className={className} {...rest}>
                                    {children}
                                </code>
                            )
                        },
                    }}
                >
                    {suggestion.markdown || ""}
                </ReactMarkdown>
            </article>

            <div className="flex flex-wrap items-center gap-2 text-[11px] text-zinc-500">
                {suggestion.confidence && <Pill>{suggestion.confidence} confidence</Pill>}
                {suggestion.graph_id && <Pill mono>graph: {suggestion.graph_id}</Pill>}
                {indexedSha && <Pill mono>sha: {indexedSha.slice(0, 7)}</Pill>}
                {suggestion.duration_ms != null && <Pill>{(suggestion.duration_ms / 1000).toFixed(1)}s</Pill>}
            </div>
        </div>
    )
}

function CitationLink({
    file,
    line,
    repo,
    sha,
}: {
    file: string
    line?: number
    repo: RepoRef
    sha: string | null
}) {
    const url = blobUrl(repo, file, line, sha)
    const label = line ? `${file}:${line}` : file
    if (!url) {
        return (
            <span className="inline-flex items-center gap-1 rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1 font-mono text-xs text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300">
                {label}
            </span>
        )
    }
    return (
        <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1 font-mono text-xs text-zinc-700 hover:border-zinc-300 hover:bg-white dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-950"
        >
            {label}
            <ExternalLinkIcon />
        </a>
    )
}

function NeedsIndexing() {
    return (
        <p className="mt-3 rounded-lg bg-amber-50 p-3 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
            Enable the <strong>bobby-analyser</strong> integration on this project and run <em>Index now</em> first. Suggestions need an indexed knowledge graph to cite files and lines.
        </p>
    )
}

function Pill({ children, mono }: { children: React.ReactNode; mono?: boolean }) {
    return (
        <span className={`rounded-md bg-zinc-100 px-1.5 py-0.5 dark:bg-zinc-800 ${mono ? "font-mono" : ""}`}>
            {children}
        </span>
    )
}

function timeAgo(iso: string): string {
    const ms = Date.now() - new Date(iso).getTime()
    const s = Math.round(ms / 1000)
    if (s < 60) return `${s}s ago`
    const m = Math.round(s / 60)
    if (m < 60) return `${m}m ago`
    const h = Math.round(m / 60)
    if (h < 24) return `${h}h ago`
    const d = Math.round(h / 24)
    return `${d}d ago`
}

function SparklesIcon() {
    return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M12 3v18M3 12h18M5.5 5.5l13 13M18.5 5.5l-13 13" />
        </svg>
    )
}
function ExternalLinkIcon() {
    return (
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14L21 3" />
        </svg>
    )
}
