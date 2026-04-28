"use client"

import { useState } from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { blobUrl, type RepoRef } from "@/lib/github"

interface QueryResult {
    markdown: string
    graph_cites?: string[]
    code_cites?: { file: string; line?: number }[]
    confidence?: string
    stop_reason?: string
    cost_usd: number
    duration_ms: number
    tool_calls?: number
}

type Turn =
    | { kind: "answer"; question: string; result: QueryResult; askedAt: number }
    | { kind: "error";  question: string; message: string;     askedAt: number }

export function AskPanel({
    projectId,
    repo,
    indexedSha,
}: {
    projectId: string
    repo: RepoRef | null
    indexedSha: string | null
}) {
    const [question, setQuestion] = useState("")
    const [busy, setBusy] = useState(false)
    const [turns, setTurns] = useState<Turn[]>([])

    async function submit(e: React.FormEvent) {
        e.preventDefault()
        const q = question.trim()
        if (!q || busy) return
        setBusy(true)
        const askedAt = Date.now()
        try {
            const res = await fetch(`/api/projects/${projectId}/ask`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ question: q }),
            })
            if (!res.ok) {
                const e = await res.json().catch(() => ({}))
                const message = e?.error?.message || `Request failed (${res.status})`
                setTurns((prev) => [{ kind: "error", question: q, message, askedAt }, ...prev])
                return
            }
            const result = (await res.json()) as QueryResult
            setTurns((prev) => [{ kind: "answer", question: q, result, askedAt }, ...prev])
            setQuestion("")
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err)
            setTurns((prev) => [{ kind: "error", question: q, message, askedAt }, ...prev])
        } finally {
            setBusy(false)
        }
    }

    return (
        <div className="flex flex-col gap-4">
            <form onSubmit={submit} className="card">
                <label htmlFor="ask-q" className="text-[10.5px] font-bold uppercase tracking-[0.10em] text-[color:var(--c-text-dim)]">
                    Question
                </label>
                <textarea
                    id="ask-q"
                    value={question}
                    onChange={(e) => setQuestion(e.target.value)}
                    onKeyDown={(e) => {
                        if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                            e.preventDefault()
                            void submit(e as unknown as React.FormEvent)
                        }
                    }}
                    placeholder="e.g. Where is auth handled? How does the indexer pipeline work?"
                    rows={3}
                    disabled={busy}
                    className="input mt-1.5 w-full resize-y text-[13px] leading-6"
                />
                <div className="mt-2 flex items-center justify-between gap-3">
                    <span className="text-[11px] text-[color:var(--c-text-muted)]">
                        ⌘/Ctrl + Enter to submit
                    </span>
                    <button type="submit" disabled={busy || !question.trim()} className="btn-primary">
                        {busy ? "Asking…" : "Ask"}
                    </button>
                </div>
            </form>

            {turns.length === 0 && !busy && (
                <p className="text-[12.5px] text-[color:var(--c-text-muted)]">
                    Answers will appear here. They&apos;re kept in this tab only — refreshing clears the history.
                </p>
            )}

            <div className="flex flex-col gap-4">
                {turns.map((t) => (
                    <TurnCard key={t.askedAt} turn={t} repo={repo} indexedSha={indexedSha} />
                ))}
            </div>
        </div>
    )
}

function TurnCard({ turn, repo, indexedSha }: { turn: Turn; repo: RepoRef | null; indexedSha: string | null }) {
    return (
        <div className="card">
            <div className="text-[10.5px] font-bold uppercase tracking-[0.10em] text-[color:var(--c-text-dim)]">
                You asked
            </div>
            <p className="mt-1 whitespace-pre-wrap text-[13px] leading-6 text-[color:var(--c-text)]">{turn.question}</p>

            <div className="mt-4 border-t border-[color:var(--c-border)] pt-4">
                {turn.kind === "error" ? (
                    <div className="rounded-[12px] bg-rose-50 px-3 py-2 text-[12.5px] text-rose-800">
                        {turn.message}
                    </div>
                ) : (
                    <Answer result={turn.result} repo={repo} indexedSha={indexedSha} />
                )}
            </div>
        </div>
    )
}

function Answer({ result, repo, indexedSha }: { result: QueryResult; repo: RepoRef | null; indexedSha: string | null }) {
    return (
        <div className="flex flex-col gap-4">
            <div className="prose-tracker">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {result.markdown || "_(empty answer)_"}
                </ReactMarkdown>
            </div>

            {result.code_cites && result.code_cites.length > 0 && (
                <div>
                    <SectionLabel>Files</SectionLabel>
                    <ul className="mt-2 flex flex-col gap-1">
                        {result.code_cites.map((c, i) => (
                            <li key={`${c.file}:${c.line ?? ""}:${i}`} className="text-[12.5px]">
                                <CiteLink file={c.file} line={c.line} repo={repo} sha={indexedSha} />
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            {result.graph_cites && result.graph_cites.length > 0 && (
                <div>
                    <SectionLabel>Graph notes</SectionLabel>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {result.graph_cites.map((g) => (
                            <span key={g} className="pill font-mono text-[11px]">{g}</span>
                        ))}
                    </div>
                </div>
            )}

            <Meta result={result} />
        </div>
    )
}

function CiteLink({
    file,
    line,
    repo,
    sha,
}: {
    file: string
    line?: number
    repo: RepoRef | null
    sha: string | null
}) {
    const label = line && line > 0 ? `${file}:${line}` : file
    const url = repo ? blobUrl(repo, file, line, sha) : null
    if (!url) {
        return <span className="font-mono text-[color:var(--c-text-muted)]">{label}</span>
    }
    return (
        <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className="font-mono text-[color:var(--c-text)] hover:underline"
        >
            {label}
        </a>
    )
}

function Meta({ result }: { result: QueryResult }) {
    const parts: string[] = []
    if (result.confidence) parts.push(`confidence: ${result.confidence}`)
    if (result.stop_reason && result.stop_reason !== "completed") parts.push(`stop: ${result.stop_reason}`)
    parts.push(`$${result.cost_usd.toFixed(4)}`)
    parts.push(`${(result.duration_ms / 1000).toFixed(1)}s`)
    if (result.tool_calls) parts.push(`${result.tool_calls} tool calls`)
    return (
        <div className="text-[11px] text-[color:var(--c-text-muted)]">
            {parts.join(" · ")}
        </div>
    )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
    return (
        <div className="text-[10.5px] font-bold uppercase tracking-[0.10em] text-[color:var(--c-text-dim)]">
            {children}
        </div>
    )
}
