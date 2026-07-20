// /pr/analyse (agentic PR review, detached) and /pr/insight/{id}/deep-dive.

import { AnalyserError, assertConfigured, authHeader } from "./client"

export interface PRAnalyseFile {
    path: string
    previous_path?: string
    status?: string
    patch?: string
    additions?: number
    deletions?: number
}

export interface PRAnalyseInput {
    repoId:  string
    number:  number
    title:   string
    body?:   string
    baseSha?: string
    headSha?: string
    files:   PRAnalyseFile[]
    maxBudgetUsd?: number
    /** Tracker project uuid — persisted with the insight + scopes the deep-dive
     *  chat (analyser ADR-0055). */
    projectId?: string
    /** Relay routing (X-Bobby-User); ignored when no worker is connected. */
    userId?: string
}

// runPRAnalysis kicks off a DETACHED, cancellable PR review on the analyser
// (POST /pr/analyse/run) and returns immediately. The analyser runs it in its
// own goroutine and POSTs the terminal result to `callback.url`. `taskId`
// correlates the callback and lets us cancel the run.
export async function runPRAnalysis(
    input: PRAnalyseInput,
    taskId: string,
    callback: { url: string; token?: string },
): Promise<void> {
    const { http } = assertConfigured()
    const res = await fetch(`${http}/pr/analyse/run`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            ...authHeader(),
            ...(input.userId ? { "X-Bobby-User": input.userId } : {}),
        },
        body: JSON.stringify({
            repo_id: input.repoId,
            project_id: input.projectId,
            number:  input.number,
            title:   input.title,
            body:    input.body,
            base_sha: input.baseSha,
            head_sha: input.headSha,
            files:   input.files,
            max_budget_usd: input.maxBudgetUsd,
            task_id: taskId,
            callback,
        }),
    })
    if (!res.ok && res.status !== 202) {
        const body = await res.json().catch(() => ({}))
        const err = body?.error || {}
        throw new AnalyserError(err.message || `pr/analyse/run failed: HTTP ${res.status}`, err.code || "pr_run_failed")
    }
}

// cancelPRAnalysis cancels an in-flight detached PR run (POST /pr/analyse/cancel)
// — e.g. the PR was closed. Best-effort.
export async function cancelPRAnalysis(taskId: string): Promise<void> {
    const { http } = assertConfigured()
    await fetch(`${http}/pr/analyse/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeader() },
        body: JSON.stringify({ task_id: taskId }),
    }).catch(() => {})
}

// deepDivePRInsight materialises a stored PR session-insight into a chat
// conversation (analyser POST /pr/insight/{id}/deep-dive, ADR-0055) and returns
// the fresh conversation_id — open the Mind chat with it and the seeded PR
// context loads on the first turn.
export async function deepDivePRInsight(
    insightId: string,
): Promise<{ conversation_id: string; repo_id?: string; project_id?: string; pr_number?: number; pr_title?: string }> {
    const { http } = assertConfigured()
    const res = await fetch(`${http}/pr/insight/${encodeURIComponent(insightId)}/deep-dive`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeader() },
    })
    if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        const err = body?.error || {}
        throw new AnalyserError(err.message || `deep-dive failed: HTTP ${res.status}`, err.code || "deep_dive_failed")
    }
    return res.json() as Promise<{ conversation_id: string; repo_id?: string; project_id?: string; pr_number?: number; pr_title?: string }>
}
