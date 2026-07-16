"use client"

import { useState } from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { useApi } from "@/lib/hooks/use-api"
import { createClient } from "@/lib/supabase/client"
import { timeAgo } from "@/components/issues/issue-meta"

// Shared GitHub comment thread for PRs and issues. Comments carry a provenance:
// 'github' rows are read-only mirrors ("edit on GitHub"); 'tracker' rows were
// authored here by author_user_id and are editable/deletable by that author.
// Writes go to `${basePath}` (POST) and `${basePath}/${github_comment_id}`
// (PATCH/DELETE); on success the parent refetches via onChanged().

export type ThreadComment = {
    github_comment_id: number
    provenance: "github" | "tracker"
    author_user_id: string | null
    author_login: string | null
    author_avatar_url: string | null
    body: string | null
    html_url: string | null
    gh_created_at: string | null
    kind?: "issue_comment" | "review"
}

// Re-run GitHub OAuth to grant repo scope; lands back on the current page with
// the token captured by /auth/callback. Mirrors app/login/page.tsx.
async function connectGithub() {
    const supabase = createClient()
    const back = window.location.pathname + window.location.search
    const redirectTo = `${new URL("/auth/callback", window.location.origin).href}?next=${encodeURIComponent(back)}`
    await supabase.auth.signInWithOAuth({
        provider: "github",
        options: { redirectTo, scopes: "repo read:user user:email" },
    })
}

export function CommentThread({
    comments,
    currentUserId,
    basePath,
    onChanged,
}: {
    comments: ThreadComment[]
    currentUserId: string | null
    basePath: string
    onChanged: () => void
}) {
    const conn = useApi<{ connected: boolean; login: string | null }>("/api/github/connection")
    const canComment = conn.data?.connected ?? false

    return (
        <section className="rounded-[16px] border border-[color:var(--c-border)] bg-white p-4 shadow-[var(--shadow-card)] sm:p-5">
            <div className="mb-3 flex items-center gap-2">
                <h2 className="text-[14px] font-bold tracking-[-0.005em]">Comments</h2>
                <span className="rounded-full bg-[color:var(--c-surface-2)] px-1.5 py-[1px] text-[11px] font-bold tabular-nums text-[color:var(--c-text-muted)]">
                    {comments.length}
                </span>
                <span className="ml-auto text-[11px] text-[color:var(--c-text-dim)]">synced with GitHub</span>
            </div>

            {comments.length === 0 ? (
                <div className="rounded-[12px] border border-dashed border-[color:var(--c-border)] bg-white px-4 py-8 text-center text-[13px] text-[color:var(--c-text-muted)]">
                    No comments yet.
                </div>
            ) : (
                <ul className="flex flex-col gap-3">
                    {comments.map((c) => (
                        <CommentRow
                            key={c.github_comment_id}
                            c={c}
                            owned={c.provenance === "tracker" && !!currentUserId && c.author_user_id === currentUserId}
                            basePath={basePath}
                            onChanged={onChanged}
                        />
                    ))}
                </ul>
            )}

            <div className="mt-4 border-t border-[color:var(--c-border)] pt-4">
                {conn.loading ? (
                    <div className="skeleton h-20 w-full rounded-[12px]" />
                ) : canComment ? (
                    <Composer basePath={basePath} onChanged={onChanged} login={conn.data?.login ?? null} />
                ) : (
                    <ConnectPrompt />
                )}
            </div>
        </section>
    )
}

function Avatar({ url, login }: { url: string | null; login: string | null }) {
    if (url) {
        // eslint-disable-next-line @next/next/no-img-element
        return <img src={url} alt="" className="mt-0.5 h-7 w-7 shrink-0 rounded-full object-cover" />
    }
    return (
        <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-zinc-200 text-[10px] font-bold text-zinc-600">
            {(login ?? "?")[0]?.toUpperCase()}
        </span>
    )
}

function ProvenanceChip({ c }: { c: ThreadComment }) {
    if (c.kind === "review") {
        return <span className="rounded-full bg-violet-50 px-1.5 py-[1px] text-[10px] font-semibold text-violet-700">review</span>
    }
    if (c.provenance === "tracker") {
        return <span className="rounded-full bg-amber-50 px-1.5 py-[1px] text-[10px] font-semibold text-amber-700">Ucelot</span>
    }
    return <span className="rounded-full bg-zinc-100 px-1.5 py-[1px] text-[10px] font-semibold text-zinc-600">GitHub</span>
}

// Every bot PR comment (loading / result / cancelled / failed) is prefixed with
// this HTML marker — kept in sync with PR_MARKER in lib/pr-sync.ts. It's the
// reliable way to spot the bot's review comment regardless of how it round-trips
// back through the GitHub webhook (which stores it as a plain issue_comment).
const PR_REVIEW_MARKER = "<!-- bobby:pr-analysis -->"

function isBotReviewComment(body: string | null): boolean {
    return !!body && body.includes(PR_REVIEW_MARKER)
}

// Collapsed stand-in for the bot review comment. The full review is rendered by
// <PrReview> at the top of the page (anchor id="pr-review"); this just points to
// it, with copy that tracks the comment's state (still reviewing vs. finished).
function ReviewPointer({ body, createdAt }: { body: string | null; createdAt: string | null }) {
    const b = body ?? ""
    const reviewing = /is reviewing this pull request/i.test(b)
    const cancelled = /closed before the review finished/i.test(b)
    const failed = /couldn't complete the review/i.test(b)
    const title = reviewing ? "PR Review in progress" : cancelled ? "PR Review cancelled" : failed ? "PR Review unavailable" : "PR Review Result"
    const sub = reviewing
        ? "Ucelot is reviewing this pull request…"
        : cancelled || failed
          ? "See the review section above"
          : `${createdAt ? `Posted ${timeAgo(createdAt)} · ` : ""}shown in full above`

    function scrollToReview() {
        const el = typeof document !== "undefined" ? document.getElementById("pr-review") : null
        if (el) el.scrollIntoView({ behavior: "smooth", block: "start" })
    }
    return (
        <li className="flex gap-2.5">
            <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-violet-100 text-violet-700">
                {reviewing ? (
                    <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-violet-300 border-t-violet-600" />
                ) : (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M9 11l3 3L22 4" />
                        <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
                    </svg>
                )}
            </span>
            <button
                type="button"
                onClick={scrollToReview}
                className="group flex min-w-0 flex-1 items-center gap-2 rounded-[12px] border border-[color:var(--c-border)] bg-[color:var(--c-surface-2)] px-3 py-2.5 text-left transition-colors hover:border-violet-300 hover:bg-violet-50/50"
            >
                <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                        <span className="text-[13px] font-semibold text-[color:var(--c-text)]">{title}</span>
                        <span className="rounded-full bg-violet-50 px-1.5 py-[1px] text-[10px] font-semibold text-violet-700">Ucelot</span>
                    </div>
                    <p className="mt-0.5 text-[11.5px] text-[color:var(--c-text-muted)]">{sub}</p>
                </div>
                <span className="flex items-center gap-1 whitespace-nowrap text-[12px] font-semibold text-violet-700 group-hover:underline">
                    View review
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M12 19V5" />
                        <path d="M5 12l7-7 7 7" />
                    </svg>
                </span>
            </button>
        </li>
    )
}

function CommentRow({
    c,
    owned,
    basePath,
    onChanged,
}: {
    c: ThreadComment
    owned: boolean
    basePath: string
    onChanged: () => void
}) {
    const [editing, setEditing] = useState(false)
    const [draft, setDraft] = useState(c.body ?? "")
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState<string | null>(null)

    // The bot's PR review comment mirrors the full "PR Review" section already
    // shown at the top of the page. It's posted as a plain issue comment (so its
    // `kind` is "issue_comment", not "review"), but every bot PR comment carries a
    // stable HTML marker — detect that and collapse it to a chip that scrolls up.
    if (isBotReviewComment(c.body)) return <ReviewPointer body={c.body} createdAt={c.gh_created_at} />

    async function save() {
        const body = draft.trim()
        if (!body) return
        setBusy(true)
        setError(null)
        const res = await fetch(`${basePath}/${c.github_comment_id}`, {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            credentials: "same-origin",
            body: JSON.stringify({ body }),
        })
        setBusy(false)
        if (!res.ok) {
            const j = await res.json().catch(() => null)
            setError(j?.error?.message ?? "Couldn't save the edit.")
            return
        }
        setEditing(false)
        onChanged()
    }

    async function remove() {
        setBusy(true)
        setError(null)
        const res = await fetch(`${basePath}/${c.github_comment_id}`, {
            method: "DELETE",
            credentials: "same-origin",
        })
        setBusy(false)
        if (!res.ok) {
            const j = await res.json().catch(() => null)
            setError(j?.error?.message ?? "Couldn't delete the comment.")
            return
        }
        onChanged()
    }

    return (
        <li className="flex gap-2.5">
            <Avatar url={c.author_avatar_url} login={c.author_login} />
            <div className="min-w-0 flex-1 rounded-[12px] border border-[color:var(--c-border)] bg-[color:var(--c-surface-2)]">
                <div className="flex items-center gap-2 border-b border-[color:var(--c-border)] px-3 py-1.5 text-[12px]">
                    <span className="font-semibold text-[color:var(--c-text)]">
                        {owned ? "You" : c.author_login ?? "unknown"}
                    </span>
                    <ProvenanceChip c={c} />
                    {c.gh_created_at && <span className="text-[color:var(--c-text-dim)]">{timeAgo(c.gh_created_at)}</span>}
                    <div className="ml-auto flex items-center gap-2">
                        {owned && !editing && (
                            <>
                                <button
                                    type="button"
                                    onClick={() => { setDraft(c.body ?? ""); setEditing(true) }}
                                    className="text-[color:var(--c-text-dim)] hover:text-[color:var(--c-text)] hover:underline"
                                >
                                    Edit
                                </button>
                                <button
                                    type="button"
                                    onClick={remove}
                                    disabled={busy}
                                    className="text-[color:var(--c-text-dim)] hover:text-rose-600 hover:underline disabled:opacity-50"
                                >
                                    Delete
                                </button>
                            </>
                        )}
                        {!owned && c.html_url && (
                            <a
                                href={c.html_url}
                                target="_blank"
                                rel="noreferrer"
                                className="text-[color:var(--c-text-dim)] hover:text-[color:var(--c-text)] hover:underline"
                            >
                                {c.provenance === "github" ? "Edit on GitHub ↗" : "View ↗"}
                            </a>
                        )}
                    </div>
                </div>

                {editing ? (
                    <div className="p-2.5">
                        <textarea
                            value={draft}
                            onChange={(e) => setDraft(e.target.value)}
                            rows={4}
                            className="w-full resize-y rounded-[8px] border border-[color:var(--c-border)] bg-white px-2.5 py-2 text-[13px] outline-none focus:border-amber-400"
                        />
                        <div className="mt-2 flex items-center gap-2">
                            <button
                                type="button"
                                onClick={save}
                                disabled={busy || !draft.trim()}
                                className="rounded-[8px] bg-zinc-900 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-zinc-800 disabled:opacity-50"
                            >
                                {busy ? "Saving…" : "Save"}
                            </button>
                            <button
                                type="button"
                                onClick={() => { setEditing(false); setError(null) }}
                                className="rounded-[8px] px-3 py-1.5 text-[12px] font-semibold text-[color:var(--c-text-muted)] hover:text-[color:var(--c-text)]"
                            >
                                Cancel
                            </button>
                        </div>
                    </div>
                ) : (
                    <div className="prose-tracker px-3 py-2 text-[13px] leading-6 text-[color:var(--c-text)]">
                        {c.body?.trim() ? (
                            <ReactMarkdown remarkPlugins={[remarkGfm]}>{c.body}</ReactMarkdown>
                        ) : (
                            <span className="text-[color:var(--c-text-dim)]">(no content)</span>
                        )}
                    </div>
                )}

                {error && <p className="px-3 pb-2 text-[11.5px] text-rose-600">{error}</p>}
            </div>
        </li>
    )
}

function Composer({
    basePath,
    onChanged,
    login,
}: {
    basePath: string
    onChanged: () => void
    login: string | null
}) {
    const [body, setBody] = useState("")
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [reauth, setReauth] = useState(false)

    async function post() {
        const text = body.trim()
        if (!text) return
        setBusy(true)
        setError(null)
        setReauth(false)
        const res = await fetch(basePath, {
            method: "POST",
            headers: { "content-type": "application/json" },
            credentials: "same-origin",
            body: JSON.stringify({ body: text }),
        })
        setBusy(false)
        if (!res.ok) {
            const j = await res.json().catch(() => null)
            if (j?.error?.code === "github_reauth_required") {
                setReauth(true)
                return
            }
            setError(j?.error?.message ?? "Couldn't post the comment.")
            return
        }
        setBody("")
        onChanged()
    }

    if (reauth) return <ConnectPrompt />

    return (
        <div>
            <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={3}
                placeholder="Write a comment…"
                className="w-full resize-y rounded-[10px] border border-[color:var(--c-border)] bg-white px-3 py-2 text-[13px] outline-none focus:border-amber-400"
            />
            <div className="mt-2 flex items-center gap-2">
                <button
                    type="button"
                    onClick={post}
                    disabled={busy || !body.trim()}
                    className="rounded-[10px] bg-zinc-900 px-3.5 py-2 text-[12.5px] font-semibold text-white hover:bg-zinc-800 disabled:opacity-50"
                >
                    {busy ? "Posting…" : "Comment"}
                </button>
                {login && (
                    <span className="text-[11.5px] text-[color:var(--c-text-dim)]">
                        posts to GitHub as <span className="font-semibold">@{login}</span>
                    </span>
                )}
                {error && <span className="text-[11.5px] text-rose-600">{error}</span>}
            </div>
        </div>
    )
}

function ConnectPrompt() {
    return (
        <div className="rounded-[12px] border border-amber-200 bg-amber-50 px-4 py-4 text-[13px] text-amber-900">
            <p className="font-semibold">Connect GitHub to comment</p>
            <p className="mt-1 text-[12.5px] text-amber-800">
                Comments are posted to GitHub as you. Connect your GitHub account (with repo access) to write here.
            </p>
            <button
                type="button"
                onClick={connectGithub}
                className="mt-3 inline-flex items-center rounded-[10px] bg-amber-900 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-amber-950"
            >
                Connect GitHub
            </button>
        </div>
    )
}
