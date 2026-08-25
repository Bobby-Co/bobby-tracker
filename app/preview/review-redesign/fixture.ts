import type { PrAnalysis } from "@/lib/shared/types"

/** The same review the existing preview renders, so the two can be compared
 *  honestly rather than through different data. */
export const REVIEW: PrAnalysis = {
    title: "Bind the region before purging regional content",
    summary:
        "- Resolves the project's cell before deleting its regional rows, so a purge can't run against the home database\n" +
        "- Moves the binding above the first regional read, which is where it was actually needed",
    impact:
        "- `ProjectDeletionService` now fails closed when a cell can't be resolved\n" +
        "- Two callers pass a project id that may not be bound yet",
    impact_files: [
        { file: "modules/projects/application/ProjectDeletionService.ts", reason: "binds the cell before the purge" },
        { file: "app/api/projects/[id]/route.ts", reason: "calls the deletion service" },
    ],
    findings: [
        {
            file: "modules/projects/application/ProjectDeletionService.ts",
            line: 88,
            severity: "critical",
            category: "bug",
            title: "Unbound cell falls through to the home database",
            detail: "findCell returns null for a project created before 0062; the purge then runs against whatever the context is already bound to.",
            evidence: [
                { file: "modules/projects/application/ProjectDeletionService.ts", line: 88, kind: "code", note: "the unguarded call" },
                { file: "lib/server/http/RequestContext.ts", line: 141, kind: "caller", note: "binds lazily, so null means home" },
            ],
            checked: ["enumerated 2 callers via get_neighbors(in)", "read the binding path"],
        },
        {
            file: "modules/projects/application/ProjectDeletionService.ts",
            line: 140,
            severity: "review",
            category: "test_gap",
            title: "No test covers the unbound path",
            detail: "ProjectDeletionService.test.ts covers the happy path and the suggestion-cleanup failure, but not a null cell.",
            evidence: [{ file: "modules/projects/application/ProjectDeletionService.test.ts", line: 1, kind: "test", note: "no case for a null cell" }],
            checked: ["ripgrep for findCell in the test file"],
            provenance: { firstSeenRound: 1, lastVerifiedRound: 1, carried: true },
        },
        {
            file: "modules/projects/application/ProjectDeletionService.ts",
            line: 60,
            severity: "good",
            category: "good",
            title: "Fails closed rather than guessing",
            detail: "Throwing beats defaulting to the home cell — a wrong purge is unrecoverable.",
        },
    ],
    fix_claims: [{ claim: "fixes deletion against the wrong region", verdict: "likely", reason: "the binding now precedes every regional read" }],
    checklist: ["confirm projects created before 0062 all have a cell", "check the delete path in staging against a region-2 project"],
    confidences: {
        correctness: { level: "medium", basis: "read 2 callers and the binding path" },
        load_perf: { level: "low", basis: "no perf-critical path inspected" },
        security: { level: "low", basis: "no untrusted input in this diff" },
    },
    checks: { precedents: 2, callers: 2, tests: 1, git_reads: 1, failure_probes: 1, dropped: 1 },
    verdict: "request_changes",
    verdict_reason: "one unguarded path can purge the wrong database",
    score: 4,
    score_max: 10,
    duration_ms: 41_200,
    insight_id: "ins_preview",
    analyser_build: "af71ce4",
}
