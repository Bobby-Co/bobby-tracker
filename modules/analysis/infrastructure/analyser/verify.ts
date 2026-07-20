// /verify — a no-LLM graph health check (request/response).

import { AnalyserError, assertConfigured, authHeader } from "./client"

export interface VerifyBrokenCite {
    note_path: string
    file: string
    line?: number
    reason: "file_not_found" | "line_out_of_range" | "empty_file" | string
}

export interface VerifyStaleNote {
    path: string
    last_commit: string
    /** -1 means the SHA isn't reachable from HEAD in this clone (treat as unknown). */
    commits_behind: number
}

export interface VerifyContentStaleNote {
    path: string
    last_commit: string
    /** Files this note cites that have been modified since note.last_commit. */
    changed_cited_files: string[]
}

export interface VerifyReport {
    generated_at: string
    head_sha: string
    notes: number
    notes_by_kind: Record<string, number>

    citations_total: number
    citations_resolved: number
    citations_broken?: VerifyBrokenCite[]
    /** 0..1; 1.0 when there are zero citations (vacuously perfect). */
    hit_rate: number

    drift_median: number
    drift_max: number
    drift_buckets: Record<string, number>
    stalest_notes?: VerifyStaleNote[]

    /** Indexed source files the bootstrap knew about. */
    indexed_files: number
    /** Indexed files cited by at least one note. */
    covered_files: number
    /** Sample of indexed files no note cites; total is uncovered_total. */
    uncovered_files?: string[]
    uncovered_total: number
    /** 0..1 covered/indexed; 1.0 when the bootstrap left no indexed-file map. */
    coverage_rate: number

    /** Notes whose cited files moved underneath them (sharper than drift). */
    content_stale_notes?: VerifyContentStaleNote[]
    content_stale_total: number

    /** 0..1 composite of hit_rate (45%), drift-decay (20%), coverage (20%), content-stale penalty (15%). */
    overall_health: number
}

export interface VerifyInput {
    repoUrl: string
    repoId: string
    repoRef?: string
    /** auth.users UUID whose stored GitHub token the analyser worker
     * fetches from tracker.github_tokens to clone private repos. The
     * preferred path — the token never crosses the wire. */
    userId?: string
    /** Optional explicit clone credential. Honored over userId by the
     * analyser; kept only as an escape hatch — normally omit it. */
    gitToken?: string
    /** Cap on the per-note BrokenCitations sample. Total counts are exact regardless. */
    maxBrokenSamples?: number
}

/** verifyGraph runs a no-LLM graph health check on the analyser server.
 * It clones the repo (server-side, ephemeral), validates every cluster
 * note's `file:line` citations against live source, and measures drift
 * (commits behind HEAD per note). Synchronous; typically 5-30s. */
export async function verifyGraph(input: VerifyInput): Promise<VerifyReport> {
    const { http } = assertConfigured()
    const body: Record<string, unknown> = {
        repo_url: input.repoUrl,
        repo_id: input.repoId,
    }
    if (input.repoRef) body.repo_ref = input.repoRef
    if (input.maxBrokenSamples) body.max_broken_samples = input.maxBrokenSamples
    if (input.userId) body.user_id = input.userId
    if (input.gitToken) {
        body.git_auth = { token: input.gitToken, username: "x-access-token", scheme: "basic" }
    }
    const res = await fetch(`${http}/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeader() },
        body: JSON.stringify(body),
    })
    if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: { message?: string; code?: string } }
        const e = err?.error || {}
        throw new AnalyserError(e.message || `verify failed: HTTP ${res.status}`, e.code || "verify_failed")
    }
    return (await res.json()) as VerifyReport
}
