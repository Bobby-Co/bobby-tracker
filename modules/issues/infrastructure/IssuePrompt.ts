// Builds a "fix this issue" prompt for a coding agent: the issue plus the
// analyser's pre-resolved file/line citations. Optimised for signal — it omits
// what an agent rediscovers by opening the repo (stack rollup, generic advice) —
// and stays safe when fields are missing (issue + project alone still works).

import type { Issue, IssueSuggestion, Project } from "@/lib/shared/types"

export interface IssuePromptInput {
    project: Pick<Project, "name" | "repo_url" | "repo_full_name" | "description">
    issue: Pick<Issue, "issue_number" | "title" | "body" | "status" | "priority" | "labels">
    suggestion: IssueSuggestion | null
}

export class IssuePrompt {
    compose(input: IssuePromptInput): string {
        const { project, issue, suggestion } = input
        const data = suggestion?.data ?? null
        const findings = data?.suggestions ?? []
        const lines: string[] = []

        const repo = project.repo_full_name ?? project.repo_url
        lines.push(`# Fix issue #${issue.issue_number} in \`${repo}\``)
        lines.push("")
        if (project.description?.trim()) {
            lines.push(`_${project.description.trim()}_`)
            lines.push("")
        }

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
            lines.push("## Analyser notes")
            lines.push("")
            lines.push(data.summary.trim())
            lines.push("")
        }

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
}
