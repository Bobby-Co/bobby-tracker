// /issues/analyse (structured issue analysis, sync + detached) and
// /issues/preferences (per-project analyse defaults).

import type { AnalyseEffort } from "../../domain/project-analyser"
import { AnalyserError, assertConfigured, authHeader } from "./client"

// Thoroughness level for issue analysis — the lowercase wire values the analyser
// expects on /issues/analyse and /issues/preferences. NB: distinct from the
// indexing `effort` ("low"|"medium"|"high") on KickoffJobInput. The type + the
// value set (ProjectAnalyser.EFFORTS / .isValidEffort) live on the ProjectAnalyser
// aggregate (client-safe); re-exported here for callers paired with these DTOs.
export type { AnalyseEffort }

export interface IssueFinding {
    file:        string
    line?:       number
    symbol?:     string
    reason:      string
    confidence?: "high" | "medium" | "low" | string
}

export interface IssueAnalysis {
    summary:      string
    suggestions:  IssueFinding[]
    confidence?:  "high" | "medium" | "low" | string
    graph_cites?: string[]
    stop_reason?: string
    cost_usd:     number
    duration_ms:  number
    tool_calls?:  number
    markdown?:    string
    /** True when the swarm that produced these suggestions ran on a
     *  locally-served model; false for cloud/remote. Always present on
     *  the wire (defaults false) — do NOT infer from cost_usd: free
     *  remotes (Ollama-cloud) report $0 and hybrid runs cost > 0 while
     *  still local. */
    local:        boolean
}

export interface IssueAnalyseInput {
    repoId:        string
    title:         string
    body?:         string
    labels?:       string[]
    priority?:     string
    maxBudgetUsd?: number
    /** Thoroughness level. Omit to let the analyser fall back to the
     *  project's saved default, then its own server default. */
    effort?:       AnalyseEffort
    /** Authenticated user id. Sent as the X-Bobby-User header so the analyser
     *  can route the ensemble swarm to this user's connected local-model relay
     *  worker (ADR-0035) when one is linked; ignored when no worker is connected. */
    userId?:       string
}

export async function analyseIssue(input: IssueAnalyseInput): Promise<IssueAnalysis> {
    const { http } = assertConfigured()
    const res = await fetch(`${http}/issues/analyse`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            ...authHeader(),
            ...(input.userId ? { "X-Bobby-User": input.userId } : {}),
        },
        // `effort` is undefined unless the caller set it; JSON.stringify drops
        // undefined keys, so an omitted effort never reaches the wire and the
        // analyser applies its own fallback chain (project default → default).
        body: JSON.stringify({
            repo_id: input.repoId,
            title:   input.title,
            body:    input.body,
            labels:  input.labels,
            priority: input.priority,
            max_budget_usd: input.maxBudgetUsd,
            effort:  input.effort,
        }),
    })
    if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        const err = body?.error || {}
        throw new AnalyserError(err.message || `analyse failed: HTTP ${res.status}`, err.code || "analyse_failed")
    }
    return (await res.json()) as IssueAnalysis
}

// runIssueAnalysis kicks off a DETACHED, cancellable analysis on the analyser
// (POST /issues/analyse/run) and returns immediately (~50ms). The analyser runs
// the analysis in its own goroutine — surviving the caller disconnecting — and
// POSTs the terminal result to `callback.url` with `Authorization: Bearer
// callback.token`. `taskId` correlates the callback and lets us cancel the run.
export async function runIssueAnalysis(
    input: IssueAnalyseInput,
    taskId: string,
    callback: { url: string; token?: string },
): Promise<void> {
    const { http } = assertConfigured()
    const res = await fetch(`${http}/issues/analyse/run`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            ...authHeader(),
            ...(input.userId ? { "X-Bobby-User": input.userId } : {}),
        },
        body: JSON.stringify({
            repo_id: input.repoId,
            title: input.title,
            body: input.body,
            labels: input.labels,
            priority: input.priority,
            effort: input.effort,
            max_budget_usd: input.maxBudgetUsd,
            task_id: taskId,
            callback,
        }),
    })
    if (!res.ok && res.status !== 202) {
        const body = await res.json().catch(() => ({}))
        const err = body?.error || {}
        throw new AnalyserError(err.message || `analyse/run failed: HTTP ${res.status}`, err.code || "analyse_run_failed")
    }
}

// cancelIssueAnalysis cancels an in-flight detached run by task id (POST
// /issues/analyse/cancel) — e.g. the GitHub issue was closed. Best-effort: a
// cancel for an already-finished/unknown task is a harmless no-op.
export async function cancelIssueAnalysis(taskId: string): Promise<void> {
    const { http } = assertConfigured()
    await fetch(`${http}/issues/analyse/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeader() },
        body: JSON.stringify({ task_id: taskId }),
    }).catch(() => {})
}

export interface IssuePreferences {
    repo_id: string
    /** The saved default effort, or "" when no default has been set (in
     *  which case the analyser uses its own server default per request). */
    effort:  AnalyseEffort | ""
}

// GET the project's saved default effort. `effort` comes back "" when unset.
export async function getIssuePreferences(repoId: string): Promise<IssuePreferences> {
    const { http } = assertConfigured()
    const url = new URL(`${http}/issues/preferences`)
    url.searchParams.set("repo_id", repoId)
    const res = await fetch(url.toString(), {
        method: "GET",
        headers: { ...authHeader() },
    })
    if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        const err = body?.error || {}
        throw new AnalyserError(err.message || `preferences fetch failed: HTTP ${res.status}`, err.code || "preferences_failed")
    }
    return (await res.json()) as IssuePreferences
}

// PUT the project's default effort. Pass "" to clear the default (falls back
// to the analyser's own server default on subsequent analyses).
export async function setIssuePreferences(repoId: string, effort: AnalyseEffort | ""): Promise<IssuePreferences> {
    const { http } = assertConfigured()
    const res = await fetch(`${http}/issues/preferences`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...authHeader() },
        body: JSON.stringify({ repo_id: repoId, effort }),
    })
    if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        const err = body?.error || {}
        throw new AnalyserError(err.message || `preferences save failed: HTTP ${res.status}`, err.code || "preferences_failed")
    }
    return (await res.json()) as IssuePreferences
}
