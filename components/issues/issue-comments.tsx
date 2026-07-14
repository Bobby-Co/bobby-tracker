"use client"

import type { IssueComment } from "@/lib/supabase/types"
import { CommentThread, type ThreadComment } from "@/components/comments/comment-thread"

// Issue comment thread — maps IssueComment rows onto the shared CommentThread.
// basePath uses the tracker issue id; the API resolves the GitHub issue number
// and posts to GitHub as the signed-in user.
export function IssueComments({
    comments,
    projectId,
    issueId,
    currentUserId,
    onChanged,
}: {
    comments: IssueComment[]
    projectId: string
    issueId: string
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
        kind: "issue_comment",
    }))
    return (
        <CommentThread
            comments={thread}
            currentUserId={currentUserId}
            basePath={`/api/projects/${projectId}/issues/${issueId}/comments`}
            onChanged={onChanged}
        />
    )
}
