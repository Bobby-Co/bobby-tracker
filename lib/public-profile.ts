// Browser-only helpers for the anonymous "profile" used by /p/<token>
// submitters. The display name lives at a single global key so a
// submitter who fills it once on one project's link reuses it on
// every other public link they visit. Submission history is keyed
// per token so different links don't bleed into each other.

const NAME_KEY = "bobby:public-profile:name"
const ISSUES_KEY = (token: string) => `bobby:public-issues:${token}`

export interface PublicSubmittedIssue {
    issue_number: number
    title: string
    created_at: string
}

export function readName(): string {
    if (typeof window === "undefined") return ""
    try { return localStorage.getItem(NAME_KEY) ?? "" } catch { return "" }
}

export function writeName(name: string) {
    if (typeof window === "undefined") return
    try {
        const trimmed = name.trim().slice(0, 80)
        if (trimmed) localStorage.setItem(NAME_KEY, trimmed)
        else localStorage.removeItem(NAME_KEY)
        // Notify any other listeners in the same tab (storage events
        // only fire cross-tab; we want intra-tab sync too).
        window.dispatchEvent(new CustomEvent("bobby:profile-changed"))
    } catch { /* quota or unavailable */ }
}

export function readIssues(token: string): PublicSubmittedIssue[] {
    if (typeof window === "undefined") return []
    try {
        const raw = localStorage.getItem(ISSUES_KEY(token))
        if (!raw) return []
        const parsed = JSON.parse(raw)
        if (!Array.isArray(parsed)) return []
        return parsed.filter(
            (x): x is PublicSubmittedIssue =>
                !!x && typeof x.issue_number === "number" && typeof x.title === "string" && typeof x.created_at === "string",
        )
    } catch { return [] }
}

export function appendIssue(token: string, issue: PublicSubmittedIssue) {
    if (typeof window === "undefined") return
    try {
        const list = readIssues(token)
        // Newest first; cap at 50 so we never blow past the storage quota.
        const next = [issue, ...list.filter((x) => x.issue_number !== issue.issue_number)].slice(0, 50)
        localStorage.setItem(ISSUES_KEY(token), JSON.stringify(next))
        window.dispatchEvent(new CustomEvent("bobby:public-issues-changed", { detail: { token } }))
    } catch { /* noop */ }
}
