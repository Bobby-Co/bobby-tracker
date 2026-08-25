// RunQueue — start the work the concurrency cap deferred.
//
// ─── What drains it, since nothing polls ─────────────────────────────────────
//
// The finishing run does. There is no scheduler in this stack, so there is no
// timer to hang a drain on; the only reliable signal that a slot has freed is the
// completion callback for the run that just vacated it. So the callback routes
// call this, and the queue is self-clocking — exactly the trick the pending-head
// continuation already uses (0080).
//
// The consequence worth stating plainly: if a callback is LOST, nothing drains at
// that moment. The queue is not stuck forever — an abandoned run stops counting
// against the cap once it goes stale (see domain/AnalysisRun.ts), so the next
// completion or the next dispatch gets things moving again — but a team whose
// last in-flight run dies silently will see its queue wait out the staleness
// window. That is the same trade the rest of this system makes: a bounded,
// documented wait rather than a background job the deployment cannot run.
//
// ─── The gate is re-checked here, and that is the point ─────────────────────
//
// A queued run was admitted, not paid for. Re-asking the spend gate at the moment
// of dispatch is what makes queueing SAFER than the refusal it replaced: fifty
// tasks queued against the last of a team's credits stop dead when the balance
// goes, whereas fifty DISPATCHED tasks would every one of them have run. Nothing
// in the queue costs anything until it passes this check.

import type { RunAllowance, SpendGate } from "@/modules/billing"
import type { ProjectsRepository } from "@/modules/projects"
import type { TeamRunRegistry } from "../ports/TeamRunRegistry"

/** How the queue actually starts a run. Narrow on purpose: the queue decides
 *  WHETHER and IN WHAT ORDER, and knows nothing about comments, profiles or
 *  scopes — the dispatch paths it calls own all of that. */
export interface QueuedDispatcher {
    startIssue(issueId: string, origin: string): Promise<void>
    startPr(projectId: string, prNumber: number, origin: string): Promise<void>
}

export interface DrainResult {
    /** Why nothing was started, when nothing was: a spend refusal's reason, or
     *  "at_capacity". Null when the queue was worked. */
    blocked: string | null
    started: number
}

/** How many runs one drain will start for an uncapped (Apex) team.
 *
 *  An uncapped team should never be queueing in the first place, so anything
 *  found here is residue — rows queued under a smaller plan, before an upgrade.
 *  They deserve to run, but releasing an unbounded number of them in a single
 *  pass would be its own stampede, so they go out in batches across successive
 *  drains. */
const UNCAPPED_BATCH = 8

export class RunQueue {
    constructor(
        private readonly spend: SpendGate,
        private readonly allowance: RunAllowance,
        private readonly runs: TeamRunRegistry,
        private readonly projects: ProjectsRepository,
        private readonly dispatch: QueuedDispatcher,
    ) {}

    /** Drain for the team owning `projectId` — the shape the completion callbacks
     *  have, since a callback knows the run that finished and not the team that
     *  paid for it. */
    async drainForProject(projectId: string, origin: string): Promise<DrainResult> {
        const teamId = await this.projects.findTeamId(projectId)
        if (!teamId) return { blocked: "no_team", started: 0 }
        return this.drain(teamId, origin)
    }

    async drain(teamId: string, origin: string): Promise<DrainResult> {
        // Queued work belonging to a team that may not spend stays queued. It is
        // not discarded: an allowance resets at the period boundary and a pause is
        // undone by whoever paused it, and in both cases the user's answer to
        // "what happened to my analysis?" should be "it is still waiting".
        const refusal = await this.spend.check(teamId)
        if (refusal) return { blocked: refusal.reason, started: 0 }

        const cap = await this.allowance.forTeam(teamId)
        const free = cap === null ? UNCAPPED_BATCH : cap - (await this.runs.countForTeam(teamId))
        if (free <= 0) return { blocked: "at_capacity", started: 0 }

        const queued = await this.runs.listQueuedForTeam(teamId, free)
        let started = 0
        for (const run of queued) {
            try {
                // Sequential, and each dispatch re-enters the normal start path —
                // which checks the cap again. That second check is not redundant:
                // it is what makes a race with a concurrently-arriving request
                // resolve by re-queueing rather than by overshooting.
                if (run.kind === "issue") await this.dispatch.startIssue(run.taskId, origin)
                else if (run.prNumber !== undefined) {
                    await this.dispatch.startPr(run.projectId, run.prNumber, origin)
                }
                started++
            } catch (e) {
                // One run that cannot start must not strand the rest of the queue
                // behind it. It keeps its 'queued' status and the next drain will
                // try it again.
                console.warn(`[run-queue] could not start ${run.kind} ${run.taskId}: ${(e as Error).message}`)
            }
        }
        return { blocked: null, started }
    }
}
