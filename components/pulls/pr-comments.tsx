"use client"

import type { PrComment } from "@/lib/shared/types"
import { CommentThread, type ThreadComment } from "@/components/comments/comment-thread"

// PR comment thread — maps PrComment rows onto the shared CommentThread. Review
// summaries render as read-only "review" entries; conversation comments can be
// authored/edited by their owner and post to GitHub as the signed-in user.
export function PrComments({
    comments,
    projectId,
    prNumber,
    currentUserId,
    onChanged,
}: {
    comments: PrComment[]
    projectId: string
    prNumber: number
    currentUserId: string | null
    onChanged: () => void
}) {
    const thread: ThreadComment[] = comments.map((c) => ({
        github_comment_id: c.github_comment_id,
        provenance: c.provenance,
        author_user_id: c.author_user_id,
        author_login: c.author_login,
        author_avatar_url: c.author_avatar_url,
        body: c.body,
        html_url: c.html_url,
        gh_created_at: c.gh_created_at,
        kind: c.source === "review" ? "review" : "issue_comment",
    }))
    return (
        <CommentThread
            comments={thread}
            currentUserId={currentUserId}
            basePath={`/api/projects/${projectId}/pulls/${prNumber}/comments`}
            onChanged={onChanged}
        />
    )
}
