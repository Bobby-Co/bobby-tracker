// Issues module — repository PORT for tracker.issues. Part of the modular-DDD
// Phase 1 work (see modules/README.md): moving inline .from("issues") behind a
// repository, one cohesive method at a time.
//
// ports/ may TYPE-reference the shared DB row type (no SDK/client here); the
// Supabase implementation lives in ../infrastructure.

import type { Issue } from "@/lib/shared/types"

/** The columns a caller supplies when filing a new issue. Everything else on the
 *  row (id, issue_number, the github_* mirror fields, timestamps) is assigned by
 *  the database, so it is deliberately absent here. */
export type NewIssue = Pick<
    Issue,
    | "project_id"
    | "user_id"
    | "title"
    | "body"
    | "status"
    | "priority"
    | "labels"
    | "ai_proposed"
    | "duplicate_of_issue_id"
    | "analyse_effort"
    | "branch"
>

/** A validated column patch for an existing issue. Every key is optional — a
 *  route supplies only the fields it parsed and validated. Mirror-only GitHub
 *  columns are intentionally absent (those go through the sync store). */
export type IssuePatch = Partial<
    Pick<
        Issue,
        | "title"
        | "body"
        | "status"
        | "priority"
        | "labels"
        | "duplicate_of_issue_id"
        | "branch"
        | "starts_at"
        | "ends_at"
        | "lane_y"
        | "color"
    >
>

/** The issue projection the suggest / fix-prompt composers read. */
export type IssueSuggestContext = Pick<
    Issue,
    | "id"
    | "project_id"
    | "issue_number"
    | "title"
    | "body"
    | "status"
    | "priority"
    | "labels"
    | "analyse_effort"
    | "branch"
    | "created_at"
    | "updated_at"
>

/** One row of the duplicate-of same-project / no-chains guard. */
export type IssueDuplicateGuardRow = Pick<Issue, "id" | "project_id" | "duplicate_of_issue_id">

/** A nearest-neighbour match returned by find_similar_to_issue. */
export type SimilarIssue = { id: string; issue_number: number; title: string; status: string; similarity: number }

/** Everything the /similar route reads in one shot: the RPC matches, whether an
 *  embedding row exists yet, and the issue's created_at (for the pending→missing
 *  age cutoff). The similarity threshold + age policy stay in the route. */
export type IssueSimilarityState = { similar: SimilarIssue[]; hasEmbedding: boolean; createdAt: string | null }

export interface IssuesRepository {
    /** The project an issue belongs to — the datum the /api/issues/[id]/** authz
     *  gate needs. Null when the issue is absent/invisible (the injected client
     *  carries the caller's RLS scope). Throws {@link RepositoryError} on a query
     *  failure — a fail-safe caller folds that to null with `tryOrNull`. */
    findProjectId(issueId: string): Promise<string | null>

    /** The full issue row by id, or null when absent. Throws on query failure. */
    findById(issueId: string): Promise<Issue | null>

    /** The full issue row by id, optionally scoped to a project (the detail
     *  page's read). Null when absent / out of the given project. Throws on
     *  query failure. */
    findByIdInProject(issueId: string, projectId?: string | null): Promise<Issue | null>

    /** The suggest / fix-prompt issue projection, or null when absent. Throws. */
    findSuggestContext(issueId: string): Promise<IssueSuggestContext | null>

    /** The id/project_id/duplicate_of_issue_id rows for the given ids, for the
     *  duplicate-of same-project + no-chains guard. Throws on query failure. */
    findDuplicateGuardRows(ids: string[]): Promise<IssueDuplicateGuardRow[]>

    /** Insert a new issue and return the created row (with the DB-assigned id,
     *  issue_number, etc.). Throws {@link RepositoryError} on failure. */
    create(issue: NewIssue): Promise<Issue>

    /** Apply a validated column patch and return the updated row. Throws
     *  {@link RepositoryError} on failure. */
    update(issueId: string, patch: IssuePatch): Promise<Issue>

    /** Delete an issue by id. Throws {@link RepositoryError} on failure. */
    deleteById(issueId: string): Promise<void>

    /** The /similar read: nearest-neighbour matches + embedding presence +
     *  created_at, in one call. Throws {@link RepositoryError} on failure. */
    findSimilarityState(issueId: string, limit: number): Promise<IssueSimilarityState>

    /** Every issue across the given projects, newest first, capped at `limit` —
     *  the collection Issues feed. FAIL-SAFE ([] on error / empty input),
     *  matching the route's best-effort read. */
    listAcrossProjects(projectIds: string[], limit: number): Promise<Issue[]>

    /** Every issue for a project, newest first, capped at `limit`. THROWS. */
    listForProject(projectId: string, limit: number): Promise<Issue[]>

    /** Scheduled issues (starts_at + ends_at both set) for a project — the
     *  detail page's "peek others" set. THROWS RepositoryError. */
    listScheduled(projectId: string): Promise<Issue[]>
}
