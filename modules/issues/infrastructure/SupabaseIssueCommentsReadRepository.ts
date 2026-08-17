// Issues infrastructure — the Supabase adapter for IssueCommentsReadRepository.
// The RLS-scoped read side of issue_comments; bound to the caller's client so an
// unowned project's thread is simply not visible.

import type { SupabaseClient } from "@supabase/supabase-js"
import { RepositoryError } from "@/lib/shared/kernel"
import type { IssueComment } from "@/lib/shared/types"
import type { IssueCommentOwnership, IssueCommentsReadRepository } from "../ports/IssueCommentsReadRepository"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = SupabaseClient<any, any, any>

export class SupabaseIssueCommentsReadRepository implements IssueCommentsReadRepository {
    constructor(private readonly db: AnyDb) {}

    async listComments(projectId: string, issueNumber: number): Promise<IssueComment[]> {
        const { data, error } = await this.db
            .from("issue_comments")
            .select("*")
            .eq("project_id", projectId)
            .eq("issue_number", issueNumber)
            .order("gh_created_at", { ascending: true, nullsFirst: true })
            .returns<IssueComment[]>()
        if (error) throw new RepositoryError(error.message, { cause: error })
        return data ?? []
    }

    async findCommentOwnership(projectId: string, githubCommentId: number): Promise<IssueCommentOwnership | null> {
        // Fail-safe (null on error), matching loadOwned's ignored-error read.
        const { data } = await this.db
            .from("issue_comments")
            .select("provenance,author_user_id,issue_number")
            .eq("project_id", projectId)
            .eq("github_comment_id", githubCommentId)
            .maybeSingle<IssueCommentOwnership>()
        return data ?? null
    }
}

/** Composition seam: bind an IssueCommentsReadRepository to a specific client. */
export function createSupabaseIssueCommentsReadRepository(db: AnyDb): IssueCommentsReadRepository {
    return new SupabaseIssueCommentsReadRepository(db)
}
