"use client"

import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import type { PRComment } from "@/lib/supabase/types"
import { timeAgo } from "@/components/issues/issue-meta"

// The PR's synced GitHub thread — conversation comments (incl. Bobby's own bot
// comment) and review summaries. Read-only in v1.
export function PrComments({ comments }: { comments: PRComment[] }) {
    return (
        <section className="rounded-[16px] border border-[color:var(--c-border)] bg-white p-4 shadow-[var(--shadow-card)] sm:p-5">
            <div className="mb-3 flex items-center gap-2">
                <h2 className="text-[14px] font-bold tracking-[-0.005em]">Comments</h2>
                <span className="rounded-full bg-[color:var(--c-surface-2)] px-1.5 py-[1px] text-[11px] font-bold tabular-nums text-[color:var(--c-text-muted)]">
                    {comments.length}
                </span>
                <span className="ml-auto text-[11px] text-[color:var(--c-text-dim)]">synced from GitHub</span>
            </div>

            {comments.length === 0 ? (
                <div className="rounded-[12px] border border-dashed border-[color:var(--c-border)] bg-white px-4 py-8 text-center text-[13px] text-[color:var(--c-text-muted)]">
                    No comments synced yet.
                </div>
            ) : (
                <ul className="flex flex-col gap-3">
                    {comments.map((c) => (
                        <CommentRow key={c.id} c={c} />
                    ))}
                </ul>
            )}
        </section>
    )
}

function CommentRow({ c }: { c: PRComment }) {
    return (
        <li className="flex gap-2.5">
            {c.author_avatar_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={c.author_avatar_url} alt="" className="mt-0.5 h-7 w-7 shrink-0 rounded-full object-cover" />
            ) : (
                <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-zinc-200 text-[10px] font-bold text-zinc-600">
                    {(c.author_login ?? "?")[0]?.toUpperCase()}
                </span>
            )}
            <div className="min-w-0 flex-1 rounded-[12px] border border-[color:var(--c-border)] bg-[color:var(--c-surface-2)]">
                <div className="flex items-center gap-2 border-b border-[color:var(--c-border)] px-3 py-1.5 text-[12px]">
                    <span className="font-semibold text-[color:var(--c-text)]">{c.author_login ?? "unknown"}</span>
                    {c.source === "review" && (
                        <span className="rounded-full bg-violet-50 px-1.5 py-[1px] text-[10px] font-semibold text-violet-700">review</span>
                    )}
                    {c.gh_created_at && <span className="text-[color:var(--c-text-dim)]">{timeAgo(c.gh_created_at)}</span>}
                    {c.html_url && (
                        <a
                            href={c.html_url}
                            target="_blank"
                            rel="noreferrer"
                            className="ml-auto text-[color:var(--c-text-dim)] hover:text-[color:var(--c-text)] hover:underline"
                        >
                            View
                        </a>
                    )}
                </div>
                <div className="prose-tracker px-3 py-2 text-[13px] leading-6 text-[color:var(--c-text)]">
                    {c.body?.trim() ? (
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>{c.body}</ReactMarkdown>
                    ) : (
                        <span className="text-[color:var(--c-text-dim)]">(no content)</span>
                    )}
                </div>
            </div>
        </li>
    )
}
