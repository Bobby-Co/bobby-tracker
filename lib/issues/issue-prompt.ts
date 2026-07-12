// Compose a "fix this issue" prompt for handing off to a coding AI.
//
// Optimised for SIGNAL over context: the receiving AI already knows how
// to read a repo, so we hand it just the things it can't easily derive
// — the issue body, and the analyser's pre-resolved file/line citations
// with a one-line "why this matters" hint per finding.
//
// Things we deliberately don't include:
//   - the full project stack/architecture/modules rollup
//     (`summary_markdown`) — bloats the prompt, and an agent that opens
//     the repo will rediscover it faster than it can read 2k tokens of
//     summary
//   - filed/updated timestamps — never relevant to fixing
//   - bare graph-citation symbols — file:line already covers it
//   - generic engineering advice in the instructions ("match existing
//     style", "don't add deps") — every coding AI already does this
//
// Designed to be safe when fields are missing: if the analyser hasn't
// run yet we still emit a useful prompt from issue + project alone.

import type { Issue, IssueSuggestion, Project } from "@/lib/supabase/types"

export interface IssuePromptInput {
    project: Pick<Project, "name" | "repo_url" | "repo_full_name" | "description">
    issue: Pick<
        Issue,
        "issue_number" | "title" | "body" | "status" | "priority" | "labels"
    >
    suggestion: IssueSuggestion | null
}

export function composeIssueFixPrompt(input: IssuePromptInput): string {
    const { project, issue, suggestion } = input
    const data = suggestion?.data ?? null
    const findings = data?.suggestions ?? []
    const lines: string[] = []

    // One-line repo header. Coding AIs treat `owner/repo` as the
    // canonical project handle; the URL is there for the (rare) case
    // where it's a non-GitHub or enterprise host.
    const repo = project.repo_full_name ?? project.repo_url
    lines.push(`# Fix issue #${issue.issue_number} in \`${repo}\``)
    lines.push("")
    if (project.description?.trim()) {
        lines.push(`_${project.description.trim()}_`)
        lines.push("")
    }

    // Issue ---------------------------------------------------------
    const meta: string[] = [`priority \`${issue.priority}\``]
    if (issue.labels.length > 0) {
        meta.push(`labels ${issue.labels.map((l) => `\`${l}\``).join(", ")}`)
    }
    lines.push(`## ${issue.title}`)
    lines.push("")
    lines.push(`<sub>${meta.join("  ·  ")}</sub>`)
    lines.push("")
    if (issue.body?.trim()) {
        lines.push(issue.body.trim())
    } else {
        lines.push("_(no description — infer intent from the title and analyser findings)_")
    }
    lines.push("")

    // Analyser findings ---------------------------------------------
    // The agentic value-add: a short list of "start here" pointers.
    // One line per finding; if there's a symbol we tuck it after the
    // path so a single grep covers it.
    if (findings.length > 0) {
        lines.push("## Start here")
        lines.push("")
        for (const f of findings) {
            const loc = f.line != null ? `${f.file}:${f.line}` : f.file
            const sym = f.symbol?.trim() ? ` (\`${f.symbol.trim()}\`)` : ""
            const why = f.reason?.trim() ? ` — ${f.reason.trim()}` : ""
            lines.push(`- \`${loc}\`${sym}${why}`)
        }
        lines.push("")
    } else if (data?.summary?.trim()) {
        // No file-level findings but a freeform summary exists — keep
        // it; it's usually 1–3 sentences of "what we think is broken".
        lines.push("## Analyser notes")
        lines.push("")
        lines.push(data.summary.trim())
        lines.push("")
    }

    // Instructions --------------------------------------------------
    // Three bullets that aren't priors a coding AI already holds:
    // pin the patch to the cited surface, call out wrong citations,
    // surface ambiguity instead of guessing.
    lines.push("---")
    lines.push("")
    lines.push("Propose the **smallest patch** that fixes the root cause. ")
    lines.push("If a cited file/line looks wrong, say so and use your own reading. ")
    lines.push("If the issue is ambiguous, list your assumptions before patching.")
    lines.push("")
    lines.push("Respond with: **diagnosis** (2–3 sentences), **patch** (diff or per-file edits), **verification** (how to confirm).")
    lines.push("")

    return lines.join("\n")
}
