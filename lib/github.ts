// Helpers for building GitHub deep-links from a tracker.projects row.

export interface RepoRef {
    repo_url: string
    repo_full_name: string | null
}

// Returns "owner/repo" from a tracker.projects row, falling back to parsing
// the URL if repo_full_name was never populated.
export function repoFullName(p: RepoRef): string | null {
    if (p.repo_full_name) return p.repo_full_name
    const m = p.repo_url.match(/^https?:\/\/(?:www\.)?github\.com\/([^\/]+\/[^\/?#]+?)(?:\.git)?\/?$/)
    return m ? m[1] : null
}

// blobUrl builds a GitHub blob link, optionally pinned to a specific SHA
// (so links don't drift as the default branch moves). Returns null when the
// project isn't on GitHub (e.g. self-hosted GitLab) — caller should fall
// back to a plain `file:line` label.
export function blobUrl(
    p: RepoRef,
    file: string,
    line: number | undefined,
    sha: string | null,
): string | null {
    const full = repoFullName(p)
    if (!full) return null
    const ref = sha || "HEAD"
    const cleanFile = file.replace(/^\/+/, "")
    const lineFrag = line && line > 0 ? `#L${line}` : ""
    return `https://github.com/${full}/blob/${ref}/${cleanFile}${lineFrag}`
}
