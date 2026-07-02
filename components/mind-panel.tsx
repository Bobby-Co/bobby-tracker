"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { AnimatePresence, motion } from "framer-motion"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { blobUrl, type RepoRef } from "@/lib/github"

// ── Types mirroring the analyser /chat SSE events + final answer ──────────────

interface ChatCitation {
    file: string
    line?: number
    valid: boolean
}
interface ChatResult {
    answer_markdown: string
    citations: ChatCitation[]
    confidence: string
    cost_usd: number
    duration_ms: number
    agents_run: number
    local?: boolean
}
interface Progress {
    stage: string // planning | exploring | grounding | pinpointing | synthesizing
    detail: string // the single "current state" line shown while thinking
}
type Message =
    | { id: string; role: "user"; text: string }
    | {
          id: string
          role: "assistant"
          streaming: boolean
          progress: Progress
          result?: ChatResult
          error?: string
      }

const STAGES: { key: string; label: string }[] = [
    { key: "planning", label: "Planning" },
    { key: "exploring", label: "Exploring" },
    { key: "grounding", label: "Grounding" },
    { key: "pinpointing", label: "Reading code" },
    { key: "synthesizing", label: "Writing answer" },
]

const EXAMPLES = [
    "How does the indexing pipeline work?",
    "Where is authentication handled?",
    "What happens when a job fails?",
]

export function MindPanel({
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
    const [messages, setMessages] = useState<Message[]>([])
    const endRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" })
    }, [messages])

    const patchAssistant = useCallback(
        (id: string, patch: (m: Extract<Message, { role: "assistant" }>) => Extract<Message, { role: "assistant" }>) => {
            setMessages((prev) => prev.map((m) => (m.id === id && m.role === "assistant" ? patch(m) : m)))
        },
        [],
    )

    const submit = useCallback(
        async (raw: string) => {
            const q = raw.trim()
            if (!q || busy) return
            setBusy(true)
            setQuestion("")

            const userId = `u-${Date.now()}`
            const botId = `a-${Date.now()}`
            const history = messages
                .map((m) =>
                    m.role === "user"
                        ? { role: "user" as const, content: m.text }
                        : { role: "assistant" as const, content: m.result?.answer_markdown ?? "" },
                )
                .filter((m) => m.content)

            setMessages((prev) => [
                ...prev,
                { id: userId, role: "user", text: q },
                {
                    id: botId,
                    role: "assistant",
                    streaming: true,
                    progress: { stage: "planning", detail: "Waking up…" },
                },
            ])

            try {
                const res = await fetch(`/api/projects/${projectId}/mind`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ question: q, history }),
                })
                if (!res.ok || !res.body) {
                    const e = await res.json().catch(() => ({}))
                    throw new Error(e?.error?.message || `Request failed (${res.status})`)
                }
                await readSSE(res.body, (ev) => {
                    if (ev.type === "stage" || ev.type === "activity") {
                        patchAssistant(botId, (m) => ({
                            ...m,
                            progress: {
                                stage: ev.stage || m.progress.stage,
                                detail: ev.detail || m.progress.detail,
                            },
                        }))
                    } else if (ev.type === "answer" && ev.answer) {
                        const answer = ev.answer
                        patchAssistant(botId, (m) => ({ ...m, streaming: false, result: answer }))
                    } else if (ev.type === "error") {
                        patchAssistant(botId, (m) => ({ ...m, streaming: false, error: ev.error || "Something went wrong" }))
                    }
                })
                // Stream ended without a terminal event → mark done.
                patchAssistant(botId, (m) =>
                    m.streaming ? { ...m, streaming: false, error: m.error ?? "The connection ended before an answer arrived." } : m,
                )
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err)
                patchAssistant(botId, (m) => ({ ...m, streaming: false, error: message }))
            } finally {
                setBusy(false)
            }
        },
        [busy, messages, projectId, patchAssistant],
    )

    return (
        <div className="flex min-h-[60vh] flex-col gap-4">
            <header>
                <h2 className="h-section">Mind</h2>
                <p className="mt-1 text-[13px] text-[color:var(--c-text-muted)]">
                    Ask anything about this repo. Bobby explores the codebase graph and answers with citations to specific files and lines.
                </p>
            </header>

            {messages.length === 0 && <EmptyState onPick={(q) => void submit(q)} />}

            <div className="flex flex-1 flex-col gap-4">
                <AnimatePresence initial={false}>
                    {messages.map((m) =>
                        m.role === "user" ? (
                            <UserBubble key={m.id} text={m.text} />
                        ) : (
                            <AssistantBubble key={m.id} msg={m} repo={repo} indexedSha={indexedSha} />
                        ),
                    )}
                </AnimatePresence>
                <div ref={endRef} />
            </div>

            <Composer value={question} onChange={setQuestion} onSubmit={() => void submit(question)} busy={busy} />
        </div>
    )
}

// ── Composer ──────────────────────────────────────────────────────────────────

function Composer({
    value,
    onChange,
    onSubmit,
    busy,
}: {
    value: string
    onChange: (v: string) => void
    onSubmit: () => void
    busy: boolean
}) {
    return (
        <form
            onSubmit={(e) => {
                e.preventDefault()
                onSubmit()
            }}
            className="card sticky bottom-4 z-10 shadow-panel"
        >
            <textarea
                value={value}
                onChange={(e) => onChange(e.target.value)}
                onKeyDown={(e) => {
                    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                        e.preventDefault()
                        onSubmit()
                    }
                }}
                placeholder="Ask about this codebase…"
                rows={2}
                className="input w-full resize-y text-[13px] leading-6"
            />
            <div className="mt-2 flex items-center justify-between gap-3">
                <span className="text-[11px] text-[color:var(--c-text-muted)]">⌘/Ctrl + Enter to send</span>
                <button type="submit" disabled={busy || !value.trim()} className="btn-primary">
                    {busy ? "Thinking…" : "Send"}
                </button>
            </div>
        </form>
    )
}

// ── Messages ───────────────────────────────────────────────────────────────────

function UserBubble({ text }: { text: string }) {
    return (
        <motion.div
            layout
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            className="flex justify-end"
        >
            <div className="max-w-[85%] rounded-[14px] rounded-br-[4px] bg-[color:var(--c-primary)] px-3.5 py-2.5 text-[13px] leading-6 text-white shadow-card">
                <p className="whitespace-pre-wrap">{text}</p>
            </div>
        </motion.div>
    )
}

function AssistantBubble({
    msg,
    repo,
    indexedSha,
}: {
    msg: Extract<Message, { role: "assistant" }>
    repo: RepoRef | null
    indexedSha: string | null
}) {
    return (
        <motion.div
            layout
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            className="flex justify-start"
        >
            <div className="w-full max-w-[92%]">
                {msg.result ? (
                    <div className="card">
                        <Answer result={msg.result} repo={repo} indexedSha={indexedSha} />
                    </div>
                ) : msg.error ? (
                    <div className="rounded-[14px] bg-rose-50 px-3.5 py-2.5 text-[12.5px] text-rose-800">{msg.error}</div>
                ) : (
                    <ThinkingCard progress={msg.progress} />
                )}
            </div>
        </motion.div>
    )
}

// ── Live progress ("thinking") ──────────────────────────────────────────────────

// ThinkingCard is the "alive" state shown while Bobby works: a Siri-style
// animated orb + a single evolving current-state line (no timeline). The card
// breathes with a soft ember ring to signal ongoing thought.
function ThinkingCard({ progress }: { progress: Progress }) {
    const text = progress.detail || stageLabel(progress.stage)
    return (
        <motion.div
            className="card flex items-center gap-3"
            animate={{
                boxShadow: [
                    "0 0 0 0 rgba(233,115,15,0.0)",
                    "0 0 0 3px rgba(233,115,15,0.10)",
                    "0 0 0 0 rgba(233,115,15,0.0)",
                ],
            }}
            transition={{ repeat: Infinity, duration: 2.2, ease: "easeInOut" }}
        >
            <ThinkingOrb />
            <div className="min-w-0 flex-1">
                <AnimatePresence mode="wait">
                    <motion.p
                        key={text}
                        initial={{ opacity: 0, y: 4 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -4 }}
                        transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
                        className="truncate text-[13px] font-medium text-[color:var(--c-text)]"
                    >
                        {text}
                    </motion.p>
                </AnimatePresence>
                <div className="mt-0.5 text-[10.5px] uppercase tracking-[0.12em] text-[color:var(--c-text-dim)]">
                    {stageLabel(progress.stage)}
                </div>
            </div>
        </motion.div>
    )
}

// ThinkingOrb is a Siri-like living gradient orb: two counter-rotating conic
// gradients (a blurred glow + a crisp core) that breathe, with a glossy
// highlight. Pure motion — no external assets.
function ThinkingOrb() {
    const grad = "conic-gradient(from 0deg, #e9730f, #f59e0b, #f4b183, #c2410c, #e9730f)"
    return (
        <span className="relative inline-flex h-8 w-8 shrink-0 items-center justify-center">
            <motion.span
                aria-hidden
                className="absolute inset-0 rounded-full blur-[7px] opacity-70"
                style={{ background: grad }}
                animate={{ rotate: 360, scale: [1, 1.18, 1] }}
                transition={{
                    rotate: { repeat: Infinity, duration: 5, ease: "linear" },
                    scale: { repeat: Infinity, duration: 1.9, ease: "easeInOut" },
                }}
            />
            <motion.span
                aria-hidden
                className="relative h-[18px] w-[18px] rounded-full"
                style={{ background: grad }}
                animate={{ rotate: -360, scale: [1, 1.12, 1] }}
                transition={{
                    rotate: { repeat: Infinity, duration: 4, ease: "linear" },
                    scale: { repeat: Infinity, duration: 1.6, ease: "easeInOut" },
                }}
            />
            <span
                aria-hidden
                className="absolute h-[18px] w-[18px] rounded-full"
                style={{ background: "radial-gradient(circle at 32% 28%, rgba(255,255,255,0.65), transparent 45%)" }}
            />
        </span>
    )
}

// ── Answer ──────────────────────────────────────────────────────────────────────

function Answer({ result, repo, indexedSha }: { result: ChatResult; repo: RepoRef | null; indexedSha: string | null }) {
    const cited = result.citations ?? []
    return (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.25 }} className="flex flex-col gap-4">
            <div className="prose-tracker">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{result.answer_markdown || "_(empty answer)_"}</ReactMarkdown>
            </div>

            {cited.length > 0 && (
                <div>
                    <SectionLabel>Citations</SectionLabel>
                    <ul className="mt-2 flex flex-col gap-1">
                        {cited.map((c, i) => (
                            <li key={`${c.file}:${c.line ?? ""}:${i}`} className="flex items-center gap-1.5 text-[12.5px]">
                                <CiteLink file={c.file} line={c.line} repo={repo} sha={indexedSha} />
                                {!c.valid && (
                                    <span
                                        className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700"
                                        title="Not found in the retrieved evidence"
                                    >
                                        unverified
                                    </span>
                                )}
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            <Meta result={result} />
        </motion.div>
    )
}

function CiteLink({ file, line, repo, sha }: { file: string; line?: number; repo: RepoRef | null; sha: string | null }) {
    const label = line && line > 0 ? `${file}:${line}` : file
    const url = repo ? blobUrl(repo, file, line, sha) : null
    if (!url) return <span className="font-mono text-[color:var(--c-text-muted)]">{label}</span>
    return (
        <a href={url} target="_blank" rel="noreferrer" className="font-mono text-[color:var(--c-text)] hover:underline">
            {label}
        </a>
    )
}

function Meta({ result }: { result: ChatResult }) {
    const parts: string[] = []
    if (result.confidence) parts.push(`confidence: ${result.confidence}`)
    if (result.agents_run) parts.push(`${result.agents_run} agents`)
    parts.push(`$${result.cost_usd.toFixed(4)}`)
    parts.push(`${(result.duration_ms / 1000).toFixed(1)}s`)
    if (result.local) parts.push("local")
    return <div className="text-[11px] text-[color:var(--c-text-muted)]">{parts.join(" · ")}</div>
}

function SectionLabel({ children }: { children: React.ReactNode }) {
    return <div className="text-[10.5px] font-bold uppercase tracking-[0.10em] text-[color:var(--c-text-dim)]">{children}</div>
}

function EmptyState({ onPick }: { onPick: (q: string) => void }) {
    return (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }} className="card">
            <p className="text-[13px] text-[color:var(--c-text)]">Ask Bobby about this codebase. Try:</p>
            <div className="mt-3 flex flex-wrap gap-2">
                {EXAMPLES.map((q) => (
                    <button key={q} type="button" onClick={() => onPick(q)} className="btn-ghost text-[12px]">
                        {q}
                    </button>
                ))}
            </div>
        </motion.div>
    )
}

function stageLabel(stage: string): string {
    return STAGES.find((s) => s.key === stage)?.label ?? "Thinking"
}

// ── SSE reader ────────────────────────────────────────────────────────────────

interface SSEEvent {
    type: "stage" | "activity" | "answer" | "error"
    stage?: string
    detail?: string
    file?: string
    answer?: ChatResult
    error?: string
}

// readSSE parses a text/event-stream body, invoking onEvent for every complete
// `event: <type>\ndata: <json>\n\n` frame.
async function readSSE(body: ReadableStream<Uint8Array>, onEvent: (ev: SSEEvent) => void): Promise<void> {
    const reader = body.getReader()
    const decoder = new TextDecoder()
    let buf = ""
    for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        let sep: number
        while ((sep = buf.indexOf("\n\n")) >= 0) {
            const frame = buf.slice(0, sep)
            buf = buf.slice(sep + 2)
            const ev = parseFrame(frame)
            if (ev) onEvent(ev)
        }
    }
}

function parseFrame(frame: string): SSEEvent | null {
    let event = "message"
    const dataLines: string[] = []
    for (const line of frame.split("\n")) {
        if (line.startsWith("event:")) event = line.slice(6).trim()
        else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim())
    }
    if (dataLines.length === 0) return null
    try {
        const data = JSON.parse(dataLines.join("\n"))
        return { ...data, type: (data.type as SSEEvent["type"]) || (event as SSEEvent["type"]) }
    } catch {
        return null
    }
}
