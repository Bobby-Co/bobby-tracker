// A reference to a linked repository — resolves owner/repo and builds GitHub
// deep-links. A value object over a tracker.projects row's repo fields; construct
// with RepoRef.of(row) at the point of use (the raw fields stay a plain DTO so
// they can cross the server→client prop boundary).

/** The raw repo fields a RepoRef wraps (a tracker.projects row subset). */
export interface RepoRefFields {
    repo_url: string
    repo_full_name: string | null
}

export class RepoRef {
    private constructor(private readonly fields: RepoRefFields) {}

    static of(fields: RepoRefFields): RepoRef {
        return new RepoRef(fields)
    }

    /** "owner/repo" (GitHub) or "group/…/project" (GitLab) — repo_full_name, else
     *  parsed from repo_url's path. Works for any host (GitHub, GitLab, self-
     *  managed); null when the URL can't be parsed. */
    fullName(): string | null {
        const { repo_full_name, repo_url } = this.fields
        if (repo_full_name) return repo_full_name
        try {
            const path = new URL(repo_url).pathname.replace(/^\/+/, "").replace(/\/+$/, "").replace(/\.git$/i, "")
            return path || null
        } catch {
            return null
        }
    }

    /** The repo host (e.g. 'github.com', 'gitlab.com', 'git.acme.com'). */
    private host(): string | null {
        try {
            return new URL(this.fields.repo_url).hostname.toLowerCase()
        } catch {
            return null
        }
    }

    /** A blob deep-link for file[:line], optionally pinned to `sha`. GitLab uses a
     *  `/-/blob/` path; GitHub uses `/blob/`. Null when the URL can't be resolved —
     *  the caller falls back to a plain file:line label. */
    blobUrl(file: string, line?: number | null, sha?: string | null): string | null {
        const full = this.fullName()
        const host = this.host()
        if (!full || !host) return null
        const ref = sha || "HEAD"
        const cleanFile = file.replace(/^\/+/, "")
        const lineFrag = line && line > 0 ? `#L${line}` : ""
        // GitHub is /blob/; every GitLab instance is /-/blob/.
        const seg = host === "github.com" ? "blob" : "-/blob"
        return `https://${host}/${full}/${seg}/${ref}/${cleanFile}${lineFrag}`
    }
}
