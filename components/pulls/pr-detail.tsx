"use client"

import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import type { PullRequest, PullRequestAnalysis } from "@/lib/supabase/types"
import { PrStateChip, ReviewChip } from "@/components/pulls/pr-meta"

// PR-detail header: title + state, author, branches, diff stats, external link,
// and the PR body (markdown). Read-only in v1.
export function PrDetail({ pr, reviewStatus }: { pr: PullRequest; reviewStatus: PullRequestAnalysis["status"] }) {
    return (
        <article className="rounded-[16px] border border-[color:var(--c-border)] bg-white p-4 shadow-[var(--shadow-card)] sm:p-5">
            <div className="flex items-start gap-2">
                <h1 className="min-w-0 flex-1 text-[18px] font-bold leading-snug tracking-[-0.01em] sm:text-[20px]">
                    <span className="mr-1.5 font-mono text-[color:var(--c-text-dim)]">#{pr.pr_number}</span>
                    {pr.title}
                </h1>
                <div className="flex shrink-0 items-center gap-1.5">
                    <ReviewChip status={reviewStatus} />
                    <PrStateChip pr={pr} />
                </div>
            </div>

            <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-2 text-[12px] text-[color:var(--c-text-muted)]">
                {pr.author_login && (
                    <span className="inline-flex items-center gap-1.5">
                        {pr.author_avatar_url && (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={pr.author_avatar_url} alt="" className="h-5 w-5 rounded-full object-cover" />
                        )}
                        <span className="font-semibold text-[color:var(--c-text)]">{pr.author_login}</span>
                    </span>
                )}
                {pr.base_ref && (
                    <span className="inline-flex items-center gap-1 rounded-full border border-[color:var(--c-border)] bg-[color:var(--c-surface-2)] px-2 py-[2px] font-mono text-[11px]">
                        {pr.head_ref} <span className="text-[color:var(--c-text-dim)]">→</span> {pr.base_ref}
                    </span>
                )}
                {(pr.additions != null || pr.deletions != null) && (
                    <span className="font-mono text-[11px]">
                        <span className="text-emerald-600">+{pr.additions ?? 0}</span>{" "}
                        <span className="text-rose-600">−{pr.deletions ?? 0}</span>
                        {pr.changed_files != null && (
                            <span className="text-[color:var(--c-text-dim)]">
                                {" "}· {pr.changed_files} file{pr.changed_files === 1 ? "" : "s"}
                            </span>
                        )}
                    </span>
                )}
                {pr.html_url && (
                    <a
                        href={pr.html_url}
                        target="_blank"
                        rel="noreferrer"
                        className="ml-auto inline-flex items-center gap-1 font-semibold text-[color:var(--c-text-muted)] hover:text-[color:var(--c-text)] hover:underline"
                    >
                        View on GitHub
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                            <path d="M7 17 17 7M9 7h8v8" />
                        </svg>
                    </a>
                )}
            </div>

            {pr.body?.trim() && (
                <div className="prose-tracker mt-4 border-t border-[color:var(--c-border)] pt-4 text-[13px] leading-6 text-[color:var(--c-text)]">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{pr.body}</ReactMarkdown>
                </div>
            )}
        </article>
    )
}
