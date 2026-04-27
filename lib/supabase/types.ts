// Database row types for the tracker schema. Hand-written so we don't pull
// in the supabase CLI codegen toolchain just for Phase 2; regenerate with
// `supabase gen types typescript --schema tracker` once the schema settles.

export type IssueStatus = "open" | "in_progress" | "blocked" | "done" | "archived"
export type IssuePriority = "low" | "medium" | "high" | "urgent"
export type AnalyserStatus = "disabled" | "pending" | "indexing" | "ready" | "failed"

export interface Project {
    id: string
    user_id: string
    name: string
    repo_url: string
    repo_full_name: string | null
    description: string | null
    created_at: string
    updated_at: string
}

export interface Issue {
    id: string
    project_id: string
    user_id: string
    title: string
    body: string
    status: IssueStatus
    priority: IssuePriority
    labels: string[]
    github_issue_number: number | null
    github_node_id: string | null
    issue_number: number
    created_at: string
    updated_at: string
}

export interface ProjectAnalyser {
    project_id: string
    enabled: boolean
    status: AnalyserStatus
    graph_id: string | null
    last_indexed_at: string | null
    last_indexed_sha: string | null
    last_index_cost_usd: number | null
    last_error: string | null
    updated_at: string
}

export interface IssueSuggestion {
    id: string
    issue_id: string
    markdown: string
    code_cites: { file: string; line?: number }[]
    graph_cites: string[]
    confidence: string | null
    cost_usd: number | null
    duration_ms: number | null
    graph_id: string | null
    created_at: string
}

export const ISSUE_STATUSES: IssueStatus[] = ["open", "in_progress", "blocked", "done", "archived"]
export const ISSUE_PRIORITIES: IssuePriority[] = ["low", "medium", "high", "urgent"]
