// The Issue domain aggregate — the issues context's entity.
//
// It owns the issue STATUS rules that were re-derived across the app:
//   - the "closed" set (done / archived / duplicated) — hand-written identically
//     in the projects-issues page AND the groups-issues page (the ProjectInsight
//     trigger uses the same set server-side);
//   - the tracker-status ⇄ GitHub open/closed mapping (statusToState /
//     stateToStatus in github-sync).
//
// Note the two are DELIBERATELY different on `duplicated`: it counts as "closed"
// for the app's views, but maps to GitHub `open` (a duplicate isn't a GitHub
// close). Keeping both on the entity makes that distinction explicit and single-
// sourced. Pure domain: no I/O, framework, or SDK — CLIENT-SAFE, so the issue
// pages import it from this path directly (not the server-tainted barrel).

export type IssueStatusValue = "open" | "in_progress" | "blocked" | "done" | "archived" | "duplicated"

/** Statuses the app treats as closed — an issue here drops out of the active views. */
const CLOSED_STATUSES: ReadonlySet<IssueStatusValue> = new Set<IssueStatusValue>(["done", "archived", "duplicated"])

/** The issue state the rules read. `github_issue_number` is optional so the
 *  aggregate builds from a bare status too (the list views only classify status). */
export interface IssueState {
    status: IssueStatusValue
    github_issue_number?: number | null
}

export class Issue {
    private constructor(private readonly state: IssueState) {}

    static of(state: IssueState): Issue {
        return new Issue(state)
    }

    /** In the app's "closed" set (done / archived / duplicated). */
    isClosed(): boolean {
        return CLOSED_STATUSES.has(this.state.status)
    }

    isOpen(): boolean {
        return !this.isClosed()
    }

    /** How this issue's status maps to GitHub's binary state. Only done + archived
     *  close the GitHub issue; everything else (incl. duplicated) stays open. */
    githubState(): "open" | "closed" {
        const s = this.state.status
        return s === "done" || s === "archived" ? "closed" : "open"
    }

    /** Linked to a mirrored GitHub issue. */
    isLinkedToGithub(): boolean {
        return this.state.github_issue_number != null
    }

    /** Tracker status for an inbound GitHub state (closed → done, open → open). */
    static statusFromGithubState(state: "open" | "closed"): IssueStatusValue {
        return state === "closed" ? "done" : "open"
    }
}
