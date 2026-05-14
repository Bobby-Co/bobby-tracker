// Compose a "fix this issue" prompt for handing off to a coding AI.
//
// We pack everything an external agent would otherwise have to dig up
// itself — project description, stack rollup, the issue body, and the
// analyser's pre-resolved file/line citations — into one structured
// markdown block that pastes cleanly into Claude / Cursor / Copilot.
//
// Designed to be safe when fields are missing: if the analyser hasn't
// run yet we still emit a useful prompt from issue + project alone.

import type {
    Issue,
    IssueSuggestion,
    Project,
    ProjectAnalyser,
} from "@/lib/supabase/types"

export interface IssuePromptInput {
    project: Pick<Project, "name" | "repo_url" | "repo_full_name" | "description">
    analyser: Pick<ProjectAnalyser, "summary_markdown"> | null
    issue: Pick<
        Issue,
        | "issue_number"
        | "title"
        | "body"
        | "status"
        | "priority"
        | "labels"
        | "created_at"
        | "updated_at"
    >
    suggestion: IssueSuggestion | null
}

export function composeIssueFixPrompt(input: IssuePromptInput): string {
    const { project, analyser, issue, suggestion } = input
    const data = suggestion?.data ?? null
    const findings = data?.suggestions ?? []
    const lines: string[] = []

    lines.push("# Task: fix the issue described below")
    lines.push("")
    lines.push(
        "You are a senior engineer working in the repository described in the **Project context** block. "
        + "Read the **Issue** block, then the **Analyser findings** block (a pre-resolved set of file/line "
        + "citations from an indexed code graph), then propose and implement a minimal, surgical fix.",
    )
    lines.push("")

    // Project context ----------------------------------------------------
    lines.push("## Project context")
    lines.push("")
    lines.push(`- **Name**: ${project.name}`)
    lines.push(`- **Repository**: ${project.repo_full_name ?? project.repo_url}`)
    if (project.description?.trim()) {
        lines.push(`- **Description**: ${project.description.trim()}`)
    }
    lines.push("")
    if (analyser?.summary_markdown?.trim()) {
        lines.push("### Stack & architecture rollup")
        lines.push("")
        lines.push(analyser.summary_markdown.trim())
        lines.push("")
    }

    // Issue --------------------------------------------------------------
    lines.push(`## Issue #${issue.issue_number} — ${issue.title}`)
    lines.push("")
    const meta: string[] = [
        `**Status**: \`${issue.status}\``,
        `**Priority**: \`${issue.priority}\``,
    ]
    if (issue.labels.length > 0) {
        meta.push(`**Labels**: ${issue.labels.map((l) => `\`${l}\``).join(", ")}`)
    }
    lines.push(meta.join("  ·  "))
    lines.push("")
    lines.push(`**Filed**: ${issue.created_at}  ·  **Last updated**: ${issue.updated_at}`)
    lines.push("")
    if (issue.body?.trim()) {
        lines.push("### Description")
        lines.push("")
        lines.push(issue.body.trim())
        lines.push("")
    } else {
        lines.push("### Description")
        lines.push("")
        lines.push("_(no description was provided — infer intent from the title and analyser findings)_")
        lines.push("")
    }

    // Analyser findings --------------------------------------------------
    if (suggestion && data) {
        lines.push("## Analyser findings")
        lines.push("")
        if (data.summary?.trim()) {
            lines.push("### Summary")
            lines.push("")
            lines.push(data.summary.trim())
            lines.push("")
        }
        if (findings.length > 0) {
            lines.push("### Files to investigate")
            lines.push("")
            for (const f of findings) {
                const loc = f.line != null ? `${f.file}:${f.line}` : f.file
                const conf = f.confidence ? ` _(confidence: ${f.confidence.toLowerCase()})_` : ""
                lines.push(`- \`${loc}\`${conf}`)
                if (f.symbol?.trim()) lines.push(`  - **Symbol**: \`${f.symbol.trim()}\``)
                if (f.reason?.trim()) lines.push(`  - **Why**: ${f.reason.trim()}`)
            }
            lines.push("")
        }
        if (data.graph_cites && data.graph_cites.length > 0) {
            lines.push("### Additional graph citations")
            lines.push("")
            for (const c of data.graph_cites.slice(0, 20)) lines.push(`- \`${c}\``)
            lines.push("")
        }
        if (suggestion.confidence) {
            lines.push(`_Overall analyser confidence: **${suggestion.confidence.toLowerCase()}**._`)
            lines.push("")
        }
    } else {
        lines.push("## Analyser findings")
        lines.push("")
        lines.push(
            "_(no analyser run is cached for this issue — locate the relevant code yourself using the "
            + "project description and the issue body)_",
        )
        lines.push("")
    }

    // Task framing ------------------------------------------------------
    lines.push("## Instructions")
    lines.push("")
    lines.push("1. Open the cited files first; read enough surrounding context to be confident in your diagnosis.")
    lines.push("2. Reproduce the issue when feasible (write or run a focused test, or trace the failing code path).")
    lines.push("3. Implement the **smallest patch** that fixes the root cause. Do not refactor unrelated code.")
    lines.push("4. Match the existing code style and conventions of the surrounding file.")
    lines.push("5. Do not add new dependencies unless absolutely required — explain the trade-off if you do.")
    lines.push("6. If any analyser citation looks wrong, say so explicitly and proceed using your own reading of the code.")
    lines.push("7. If the issue is ambiguous, list your assumptions before patching.")
    lines.push("")
    lines.push("## Expected response format")
    lines.push("")
    lines.push("- **Diagnosis**: 2–4 sentences on the root cause.")
    lines.push("- **Patch**: unified diff or per-file edits.")
    lines.push("- **Verification**: how you (or the user) can confirm the fix.")
    lines.push("- **Risks**: anything fragile, follow-up worth filing, or unknowns left behind.")
    lines.push("")

    return lines.join("\n")
}
