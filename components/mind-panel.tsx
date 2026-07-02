"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { AnimatePresence, motion } from "framer-motion"
import ReactMarkdown, { type Components } from "react-markdown"
import remarkGfm from "remark-gfm"
import { blobUrl, type RepoRef } from "@/lib/github"
import { cn } from "@/components/cn"
import PixelScatter from "@/components/pixel-scatter"
import { ThinkingCard, type Progress } from "@/components/mind-thinking"
import { IssueDrawer } from "@/components/issue-drawer"
import type { Issue, ProjectLabelIcon, ProjectStatusColor } from "@/lib/supabase/types"

// ── Types mirroring the analyser /chat SSE events + final answer ──────────────

interface ChatCitation {
    file: string
    line?: number
    valid: boolean
}
// ChatIssue mirrors the analyser's cited/related tracker issues (ADR-0048).
// `id` is the uuid we link to; `number` is the human #42 the answer cites.
interface ChatIssue {
    id: string
    number?: number
    title: string
    status?: string
    snippet?: string
    similarity?: number
    cited: boolean
}
interface ChatResult {
    answer_markdown: string
    citations: ChatCitation[]
    issues?: ChatIssue[]
    route?: string[]
    confidence: string
    cost_usd: number
    duration_ms: number
    agents_run: number
    local?: boolean
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
    // Stable id for this conversation, keying the analyser's managed-context
    // store (ADR-0049). One per mount — a page reload starts a fresh memory.
    const [conversationId] = useState(() => crypto.randomUUID())

    // Cited-issue drawer: clicking an issue chip opens the issue in a slide-over
    // over the mind space (no navigation). We fetch the full issue + label/status
    // metadata the shared IssueDrawer needs from the consolidated page endpoint.
    const [openIssueId, setOpenIssueId] = useState<string | null>(null)
    // Drawer data is keyed by issue id so a stale fetch never shows the wrong
    // issue: it renders only when drawer.id === openIssueId. Keeping the last
    // fetched payload around (instead of clearing it) avoids a synchronous
    // setState in the effect.
    const [drawer, setDrawer] = useState<{ id: string; issue: Issue; labelIcons: ProjectLabelIcon[]; statusColors: ProjectStatusColor[] } | null>(null)
    const openIssue = useCallback((id: string) => setOpenIssueId(id), [])
    const closeIssue = useCallback(() => setOpenIssueId(null), [])

    useEffect(() => {
        if (!openIssueId) return
        let cancelled = false
        fetch(`/api/projects/${projectId}/issues/${openIssueId}`)
            .then((r) => (r.ok ? r.json() : Promise.reject(r)))
            .then((j: { issue: Issue | null; labelIcons?: ProjectLabelIcon[]; statusColors?: ProjectStatusColor[] }) => {
                if (cancelled) return
                if (!j.issue) {
                    setOpenIssueId(null)
                    return
                }
                setDrawer({ id: openIssueId, issue: j.issue, labelIcons: j.labelIcons ?? [], statusColors: j.statusColors ?? [] })
            })
            .catch(() => {
                if (!cancelled) setOpenIssueId(null)
            })
        return () => {
            cancelled = true
        }
    }, [openIssueId, projectId])
    const activeIssue = drawer && drawer.id === openIssueId ? drawer.issue : null

    useEffect(() => {
        endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" })
    }, [messages])

    // Once the conversation starts, the backdrop washes to white; after that
    // transition the ember scatter is fully hidden, so unmount it — killing its
    // requestAnimationFrame loop and canvas — to drop the idle cost.
    const started = messages.length > 0
    const [emberMounted, setEmberMounted] = useState(true)
    const [scatterReady, setScatterReady] = useState(false)
    const [morphDone, setMorphDone] = useState(false)
    useEffect(() => {
        if (!started) return
        const t = setTimeout(() => setEmberMounted(false), 3000)
        return () => clearTimeout(t)
    }, [started])
    // Hold the backdrop reveal until the immersive morph has settled, so it fades
    // up cleanly after entering rather than flashing in mid-morph.
    useEffect(() => {
        const t = setTimeout(() => setMorphDone(true), 520)
        return () => clearTimeout(t)
    }, [])

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
            // Temporal context: the last 3 turns of raw chat. Durable structured
            // memory lives in the analyser's managed-context store, keyed by
            // conversationId (ADR-0049), so we don't accumulate a ledger here.
            const history = messages
                .map((m) =>
                    m.role === "user"
                        ? { role: "user" as const, content: m.text }
                        : { role: "assistant" as const, content: m.result?.answer_markdown ?? "" },
                )
                .filter((m) => m.content)
                .slice(-6)

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
                    body: JSON.stringify({ question: q, history, conversation_id: conversationId }),
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
        [busy, messages, projectId, conversationId, patchAssistant],
    )

    // Backdrop blur ramps from a crisp 1px at rest to a deep 20px once the first
    // question is sent (messages populate), then stays — a soft focus-pull as the
    // conversation begins.
    const blurPx = messages.length > 0 ? 20 : 1

    // "Blur first, then think": the first thinking bubble holds its entrance for a
    // beat so the backdrop starts pulling into focus before the orb appears. Later
    // turns pop in promptly.
    const firstAssistantId = messages.find((m) => m.role === "assistant")?.id

    return (
        <div className="relative flex h-full min-h-0 flex-col overflow-hidden bg-[color:var(--c-surface)]">
            {/* Waitlist ember backdrop, blurred — glows from the corners and stays
                clean toward the centre so the conversation reads over it. */}
            <div
                aria-hidden
                className="pointer-events-none absolute inset-0 overflow-hidden"
                style={{ filter: `blur(${blurPx}px)`, transition: "filter 2800ms cubic-bezier(0.4,0,0.2,1)" }}
            >
                {emberMounted && (
                    <div
                        className="absolute inset-0"
                        style={{
                            opacity: scatterReady && morphDone ? 1 : 0,
                            transform: scatterReady && morphDone ? "scale(1)" : "scale(1.06)",
                            transformOrigin: "center",
                            transition: "opacity 1000ms cubic-bezier(0.16,1,0.3,1), transform 1000ms cubic-bezier(0.16,1,0.3,1)",
                        }}
                    >
                        <PixelScatter cell={32} fill={0.7} reach={0.3} falloff={2.4} corners={["tl", "tr", "bl", "br"]} className="scale-100" onReady={() => setScatterReady(true)} />
                    </div>
                )}
            </div>

            {/* Wash to pure white as the conversation begins, in step with the
                blur — the ember shows at rest, then fades out to clean white. */}
            <div
                aria-hidden
                className="pointer-events-none absolute inset-0 bg-white"
                style={{ opacity: messages.length > 0 ? 1 : 0, transition: "opacity 2800ms cubic-bezier(0.4,0,0.2,1)" }}
            />

            <div className="relative z-10 flex min-h-0 flex-1 flex-col">
                {/* Slim chat header — the app chrome is gone in immersive mode, so
                    this carries the way back to the project and the title. */}
                <div className="flex shrink-0 items-center gap-3 px-4 py-2.5 sm:px-6">
                    <Link
                        href={`/projects/${projectId}/issues`}
                        className="inline-flex items-center gap-1.5 rounded-full border border-[color:var(--c-border)] bg-[color:var(--c-surface)]/80 px-2.5 py-1 text-[12.5px] font-medium text-[color:var(--c-text-muted)] shadow-[0_1px_1px_rgba(17,24,39,0.03)] backdrop-blur transition-colors hover:border-[color:var(--c-border-strong)] hover:text-[color:var(--c-text)]"
                    >
                        <BackIcon />
                        Back
                    </Link>
                    <span className="text-[13px] font-semibold text-[color:var(--c-text)]">Mind</span>
                    {repo?.repo_full_name && (
                        <span className="ml-auto min-w-0 truncate font-mono text-[11.5px] text-[color:var(--c-text-dim)]">{repo.repo_full_name}</span>
                    )}
                </div>

                {/* Scrolling conversation, centred in a readable column. */}
                <div className="min-h-0 flex-1 overflow-y-auto">
                    <div className={cn("mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 sm:px-6", messages.length === 0 ? "h-full justify-center pb-6" : "py-6")}>
                        {messages.length === 0 && <EmptyState onPick={(q) => void submit(q)} />}
                        <AnimatePresence initial={false}>
                            {messages.map((m) =>
                                m.role === "user" ? (
                                    <UserBubble key={m.id} text={m.text} />
                                ) : (
                                    <AssistantBubble key={m.id} msg={m} projectId={projectId} repo={repo} indexedSha={indexedSha} onOpenIssue={openIssue} delay={m.id === firstAssistantId ? 1 : 0.18} />
                                ),
                            )}
                        </AnimatePresence>
                        <div ref={endRef} />
                    </div>
                </div>

                {/* Composer pinned to the bottom, same centred column. Translucent
                    so the ember backdrop glows through. */}
                <div className="shrink-0">
                    <div className="mx-auto w-full max-w-3xl px-4 py-3 sm:px-6">
                        <Composer value={question} onChange={setQuestion} onSubmit={() => void submit(question)} busy={busy} />
                    </div>
                </div>
            </div>

            {/* Cited-issue slide-over. Opens over the mind space when a chip is
                clicked; closed when `issue` is null (during fetch or after close). */}
            <IssueDrawer
                issue={activeIssue}
                projectId={projectId}
                labelIcons={drawer?.labelIcons ?? []}
                statusColors={drawer?.statusColors ?? []}
                onClose={closeIssue}
            />
        </div>
    )
}

function BackIcon() {
    return (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M15 18l-6-6 6-6" />
        </svg>
    )
}

// ── Composer ──────────────────────────────────────────────────────────────────

// Composer — one unified input box (no nested borders): a borderless textarea
// that auto-grows, with the attachment popover and the send button living inside
// it. The whole box lights up on focus so it reads as a single field.
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
    const taRef = useRef<HTMLTextAreaElement>(null)
    const fileRef = useRef<HTMLInputElement>(null)
    const imageRef = useRef<HTMLInputElement>(null)
    const [attachments, setAttachments] = useState<File[]>([])
    const [expanded, setExpanded] = useState(false)

    // Grow the textarea with its content, up to a cap (then it scrolls).
    useEffect(() => {
        const el = taRef.current
        if (!el) return
        el.style.height = "auto"
        el.style.height = `${Math.min(el.scrollHeight, 160)}px`
    }, [value])

    const addFiles = (list: FileList | null) => {
        if (list && list.length) setAttachments((prev) => [...prev, ...Array.from(list)])
        setExpanded(false)
    }
    const canSend = !busy && (!!value.trim() || attachments.length > 0)

    return (
        <form
            onSubmit={(e) => {
                e.preventDefault()
                onSubmit()
            }}
            className="rounded-[16px] border border-[color:var(--c-border)] bg-white shadow-panel transition-[border-color,box-shadow] focus-within:border-[color:var(--c-primary)] focus-within:ring-[3px] focus-within:ring-[color:var(--c-ring)]"
        >
            {attachments.length > 0 && (
                <div className="flex flex-wrap gap-1.5 px-3 pt-3">
                    {attachments.map((f, i) => (
                        <span key={`${f.name}-${i}`} className="inline-flex items-center gap-1.5 rounded-full bg-[color:var(--c-surface-2)] px-2.5 py-1 text-[11.5px] text-[color:var(--c-text-muted)]">
                            <FileIcon />
                            <span className="max-w-[150px] truncate">{f.name}</span>
                            <button
                                type="button"
                                aria-label={`Remove ${f.name}`}
                                onClick={() => setAttachments((a) => a.filter((_, j) => j !== i))}
                                className="text-[color:var(--c-text-dim)] transition-colors hover:text-[color:var(--c-text)]"
                            >
                                <XIcon />
                            </button>
                        </span>
                    ))}
                </div>
            )}

            <textarea
                ref={taRef}
                value={value}
                onChange={(e) => onChange(e.target.value)}
                onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                        e.preventDefault()
                        onSubmit()
                    }
                }}
                placeholder="Ask about this codebase…"
                rows={1}
                className="block max-h-40 w-full resize-none bg-transparent px-4 pt-3.5 pb-1.5 text-[13px] leading-6 text-[color:var(--c-text)] outline-none placeholder:text-[color:var(--c-text-dim)]"
            />

            <div className="flex items-center justify-between gap-2 px-2.5 pb-2.5">
                <AttachmentFan
                    open={expanded}
                    onToggle={() => setExpanded((o) => !o)}
                    onClose={() => setExpanded(false)}
                    onPickFiles={() => fileRef.current?.click()}
                    onPickImage={() => imageRef.current?.click()}
                />
                <div className="flex items-center gap-2">
                    <span className="hidden text-[11px] text-[color:var(--c-text-dim)] sm:inline">Enter to send</span>
                    <button
                        type="submit"
                        disabled={!canSend}
                        aria-label="Send"
                        className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[color:var(--c-primary)] text-white shadow-sm transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                        {busy ? <Spinner /> : <SendIcon />}
                    </button>
                </div>
            </div>

            <input ref={fileRef} type="file" multiple hidden onChange={(e) => addFiles(e.target.files)} />
            <input ref={imageRef} type="file" accept="image/*" multiple hidden onChange={(e) => addFiles(e.target.files)} />
        </form>
    )
}

// AttachmentFan — the paperclip toggles a cluster of action icons that spring
// out to the right with momentum (staggered spring), and retract back into the
// clip on a second click. The clip rotates while open. Closes on outside-click
// or Escape. Action buttons are absolutely positioned so the row keeps no gap
// when collapsed.
function AttachmentFan({
    open,
    onToggle,
    onClose,
    onPickFiles,
    onPickImage,
}: {
    open: boolean
    onToggle: () => void
    onClose: () => void
    onPickFiles: () => void
    onPickImage: () => void
}) {
    const ref = useRef<HTMLDivElement>(null)
    useEffect(() => {
        if (!open) return
        const onDoc = (e: MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) onClose()
        }
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") onClose()
        }
        document.addEventListener("mousedown", onDoc)
        document.addEventListener("keydown", onKey)
        return () => {
            document.removeEventListener("mousedown", onDoc)
            document.removeEventListener("keydown", onKey)
        }
    }, [open, onClose])

    const actions = [
        { key: "file", label: "Upload from computer", icon: <UploadIcon />, run: onPickFiles },
        { key: "image", label: "Add image", icon: <ImageIcon />, run: onPickImage },
    ]
    const GAP = 38 // px between fanned icons

    return (
        <div ref={ref} className="relative flex items-center">
            <button
                type="button"
                onClick={onToggle}
                aria-label="Add attachment"
                aria-expanded={open}
                className="relative z-10 grid h-8 w-8 place-items-center rounded-full text-[color:var(--c-text-muted)] transition-colors hover:bg-[color:var(--c-overlay)] hover:text-[color:var(--c-text)]"
            >
                <motion.span animate={{ rotate: open ? 45 : 0 }} transition={{ type: "spring", stiffness: 400, damping: 18 }} className="grid place-items-center">
                    <PaperclipIcon />
                </motion.span>
            </button>
            {actions.map((a, i) => (
                <motion.button
                    key={a.key}
                    type="button"
                    aria-label={a.label}
                    title={a.label}
                    onClick={() => {
                        a.run()
                        onClose()
                    }}
                    initial={false}
                    animate={open ? { x: (i + 1) * GAP, opacity: 1, scale: 1 } : { x: 0, opacity: 0, scale: 0.4 }}
                    transition={{ type: "spring", stiffness: 420, damping: 22, delay: (open ? i : actions.length - 1 - i) * 0.045 }}
                    style={{ pointerEvents: open ? "auto" : "none" }}
                    className="absolute left-0 grid h-8 w-8 place-items-center rounded-full border border-[color:var(--c-border)] bg-white text-[color:var(--c-text-muted)] shadow-sm transition-colors hover:text-[color:var(--c-text)]"
                >
                    {a.icon}
                </motion.button>
            ))}
        </div>
    )
}

function PaperclipIcon() {
    return (
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M21 8.5l-9.19 9.19a3.5 3.5 0 0 1-4.95-4.95l9.2-9.19a2 2 0 0 1 2.83 2.83l-8.49 8.49a.5.5 0 0 1-.71-.71l7.78-7.78" />
        </svg>
    )
}
function SendIcon() {
    return (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M12 19V5M6 11l6-6 6 6" />
        </svg>
    )
}
function UploadIcon() {
    return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M12 16V4M7 9l5-5 5 5M4 20h16" />
        </svg>
    )
}
function ImageIcon() {
    return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <rect x="3" y="4" width="18" height="16" rx="2.5" />
            <circle cx="8.5" cy="9.5" r="1.6" />
            <path d="M21 16l-5-5-8 8" />
        </svg>
    )
}
function FileIcon() {
    return (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M14 3v5h5M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-5z" />
        </svg>
    )
}
function XIcon() {
    return (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M6 6l12 12M18 6L6 18" />
        </svg>
    )
}
function Spinner() {
    return (
        <span className="block h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" aria-label="Sending" />
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
    projectId,
    repo,
    indexedSha,
    onOpenIssue,
    delay = 0.18,
}: {
    msg: Extract<Message, { role: "assistant" }>
    projectId: string
    repo: RepoRef | null
    indexedSha: string | null
    onOpenIssue: (id: string) => void
    delay?: number
}) {
    return (
        <motion.div
            layout
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1], delay }}
            className="flex justify-start"
        >
            <div className="w-full">
                {msg.result ? (
                    <Answer result={msg.result} projectId={projectId} repo={repo} indexedSha={indexedSha} onOpenIssue={onOpenIssue} />
                ) : msg.error ? (
                    <div className="rounded-[14px] bg-rose-50 px-3.5 py-2.5 text-[12.5px] text-rose-800">{msg.error}</div>
                ) : (
                    <ThinkingCard progress={msg.progress} />
                )}
            </div>
        </motion.div>
    )
}

// ── Answer ──────────────────────────────────────────────────────────────────────

function Answer({ result, projectId, repo, indexedSha, onOpenIssue }: { result: ChatResult; projectId: string; repo: RepoRef | null; indexedSha: string | null; onOpenIssue: (id: string) => void }) {
    const cited = result.citations ?? []
    const issues = useMemo(() => result.issues ?? [], [result.issues])
    // Cited issues first (finaliser referenced them inline), then related matches.
    const orderedIssues = useMemo(
        () => [...issues].sort((a, b) => Number(b.cited) - Number(a.cited) || (b.similarity ?? 0) - (a.similarity ?? 0)),
        [issues],
    )
    const issueByNumber = useMemo(() => {
        const m = new Map<number, ChatIssue>()
        for (const is of issues) if (typeof is.number === "number") m.set(is.number, is)
        return m
    }, [issues])

    // Rewrite the answer's [issue:N] tokens into internal issue links so the
    // markdown renderer can turn them into chips inline (ADR-0048).
    const md = useMemo(
        () => linkifyIssues(result.answer_markdown || "_(empty answer)_", issueByNumber, projectId),
        [result.answer_markdown, issueByNumber, projectId],
    )

    // Custom renderers: issue links → IssueChip; inline `path:line` code → FileChip.
    const components = useMemo<Components>(
        () => ({
            a({ href, children }) {
                if (typeof href === "string" && href.startsWith(`/projects/${projectId}/issues/`)) {
                    const id = href.split("/").pop() ?? ""
                    return <IssueChip issue={issues.find((x) => x.id === id)} projectId={projectId} onOpen={onOpenIssue} inline />
                }
                return (
                    <a href={href} target="_blank" rel="noreferrer">
                        {children}
                    </a>
                )
            },
            code({ className, children }) {
                const text = String(children ?? "")
                // Only inline code (fenced blocks carry a language className) that
                // looks like a file:line reference becomes a chip.
                if (!className && CITE_RE.test(text)) {
                    const [file, line] = text.split(":")
                    return <FileChip file={file} line={Number(line)} repo={repo} sha={indexedSha} inline />
                }
                return <code className={className}>{children}</code>
            },
        }),
        [issues, projectId, repo, indexedSha, onOpenIssue],
    )

    return (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.25 }} className="flex flex-col gap-4">
            <div className="prose-tracker">
                <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
                    {md}
                </ReactMarkdown>
            </div>

            {orderedIssues.length > 0 && (
                <div>
                    <SectionLabel>{orderedIssues.some((i) => i.cited) ? "Issues" : "Related issues"}</SectionLabel>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                        {orderedIssues.map((is) => (
                            <IssueChip key={is.id} issue={is} projectId={projectId} onOpen={onOpenIssue} showTitle />
                        ))}
                    </div>
                </div>
            )}

            {cited.length > 0 && (
                <div>
                    <SectionLabel>Files</SectionLabel>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                        {cited.map((c, i) => (
                            <FileChip key={`${c.file}:${c.line ?? ""}:${i}`} file={c.file} line={c.line} repo={repo} sha={indexedSha} unverified={!c.valid} />
                        ))}
                    </div>
                </div>
            )}

            <Meta result={result} />
        </motion.div>
    )
}

// CITE_RE matches a bare `path/to/file.ext:line` reference (single token).
const CITE_RE = /^[A-Za-z0-9_./-]+\.[A-Za-z0-9]+:\d+$/

// linkifyIssues rewrites `[issue:42]` / `[issue:#42]` tokens into internal issue
// links (when the issue id is known) so the markdown renderer chips them; falls
// back to a plain `#42` when the number wasn't among the retrieved matches.
function linkifyIssues(md: string, byNumber: Map<number, ChatIssue>, projectId: string): string {
    return md.replace(/\[issue:#?(\d+)\]/gi, (_m, n: string) => {
        const is = byNumber.get(Number(n))
        return is?.id ? `[#${n}](/projects/${projectId}/issues/${is.id})` : `#${n}`
    })
}

// statusDot maps a tracker issue status to its palette dot (mirrors issue-meta).
function statusDot(status?: string): string | null {
    switch (status) {
        case "open":
            return "bg-blue-500"
        case "in_progress":
            return "bg-amber-500"
        case "blocked":
            return "bg-rose-500"
        case "done":
            return "bg-emerald-500"
        case "archived":
            return "bg-zinc-400"
        case "duplicated":
            return "bg-violet-500"
        default:
            return null
    }
}

// IssueChip renders a cited/related tracker issue as a clickable chip. When the
// uuid is known it opens the issue in the mind-space drawer via `onOpen` (no
// navigation); without `onOpen` it falls back to a link to the detail page, and
// without an id it's a static `#number`.
function IssueChip({ issue, projectId, onOpen, inline = false, showTitle = false }: { issue?: ChatIssue; projectId: string; onOpen?: (id: string) => void; inline?: boolean; showTitle?: boolean }) {
    const num = issue?.number
    const label = num != null ? `#${num}` : "issue"
    const dot = statusDot(issue?.status)
    const className = cn(
        "inline-flex items-center gap-1.5 rounded-full border border-[color:var(--c-border)] bg-[color:var(--c-surface)] px-2 py-[2px] text-[11.5px] align-baseline no-underline transition-colors hover:bg-[color:var(--c-surface-2)]",
        inline && "mx-0.5",
    )
    const inner = (
        <>
            {dot ? (
                <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", dot)} />
            ) : (
                <IssueGlyph />
            )}
            <span className="font-semibold text-[color:var(--c-text)]">{label}</span>
            {showTitle && issue?.title && <span className="max-w-[220px] truncate text-[color:var(--c-text-muted)]">{issue.title}</span>}
        </>
    )
    if (issue?.id && onOpen) {
        const id = issue.id
        return (
            <button type="button" onClick={() => onOpen(id)} className={cn(className, "cursor-pointer")} title={issue.title}>
                {inner}
            </button>
        )
    }
    if (issue?.id) {
        return (
            <Link href={`/projects/${projectId}/issues/${issue.id}`} className={className} title={issue.title}>
                {inner}
            </Link>
        )
    }
    return (
        <span className={className} title={issue?.title}>
            {inner}
        </span>
    )
}

// FileChip renders a `path:line` citation as a chip that opens the file on
// GitHub (blob URL) when the repo is known; otherwise a static label.
function FileChip({ file, line, repo, sha, unverified = false, inline = false }: { file: string; line?: number; repo: RepoRef | null; sha: string | null; unverified?: boolean; inline?: boolean }) {
    const label = line && line > 0 ? `${file}:${line}` : file
    const url = repo ? blobUrl(repo, file, line, sha) : null
    const className = cn(
        "inline-flex max-w-full items-center gap-1.5 rounded-full border px-2 py-[2px] font-mono text-[11px] align-baseline no-underline transition-colors",
        unverified
            ? "border-amber-200 bg-amber-50 text-amber-700"
            : "border-[color:var(--c-border)] bg-[color:var(--c-surface-2)] text-[color:var(--c-text)]",
        url && "hover:bg-[color:var(--c-surface)]",
        inline && "mx-0.5",
    )
    const inner = (
        <>
            <FileGlyph />
            <span className="truncate">{label}</span>
            {unverified && (
                <span className="font-sans text-[9.5px] font-semibold uppercase tracking-wide text-amber-600" title="Not found in the retrieved evidence">
                    unverified
                </span>
            )}
        </>
    )
    if (url) {
        return (
            <a href={url} target="_blank" rel="noreferrer" className={className} title={label}>
                {inner}
            </a>
        )
    }
    return (
        <span className={className} title={label}>
            {inner}
        </span>
    )
}

function FileGlyph() {
    return (
        <svg viewBox="0 0 16 16" width="11" height="11" className="shrink-0 opacity-60" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden>
            <path d="M9 1.5H4A1.5 1.5 0 0 0 2.5 3v10A1.5 1.5 0 0 0 4 14.5h8A1.5 1.5 0 0 0 13.5 13V6L9 1.5Z" strokeLinejoin="round" />
            <path d="M9 1.5V6h4.5" strokeLinejoin="round" />
        </svg>
    )
}

function IssueGlyph() {
    return (
        <svg viewBox="0 0 16 16" width="11" height="11" className="shrink-0 opacity-60" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden>
            <circle cx="8" cy="8" r="5.5" />
            <circle cx="8" cy="8" r="1.4" fill="currentColor" stroke="none" />
        </svg>
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
        <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
            className="flex flex-col items-center gap-3 text-center"
        >
            <h2 className="text-[22px] font-bold tracking-[-0.012em] text-[color:var(--c-text)]">Ask Bobby about this codebase</h2>
            <p className="max-w-md text-[13px] leading-6 text-[color:var(--c-text-muted)]">
                Bobby explores the codebase graph and answers with citations to specific files and lines.
            </p>
            <div className="mt-1 flex flex-wrap justify-center gap-2">
                {EXAMPLES.map((q) => (
                    <button key={q} type="button" onClick={() => onPick(q)} className="btn-ghost text-[12px]">
                        {q}
                    </button>
                ))}
            </div>
        </motion.div>
    )
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
