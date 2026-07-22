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

    /** "owner/repo" — repo_full_name, else parsed from repo_url; null when neither
     *  resolves (e.g. a self-hosted host). */
    fullName(): string | null {
        const { repo_full_name, repo_url } = this.fields
        if (repo_full_name) return repo_full_name
        const m = repo_url.match(/^https?:\/\/(?:www\.)?github\.com\/([^\/]+\/[^\/?#]+?)(?:\.git)?\/?$/)
        return m ? m[1] : null
    }

    /** A GitHub blob link for file[:line], optionally pinned to `sha`. Null when the
     *  project isn't on GitHub — the caller falls back to a plain file:line label. */
    blobUrl(file: string, line?: number | null, sha?: string | null): string | null {
        const full = this.fullName()
        if (!full) return null
        const ref = sha || "HEAD"
        const cleanFile = file.replace(/^\/+/, "")
        const lineFrag = line && line > 0 ? `#L${line}` : ""
        return `https://github.com/${full}/blob/${ref}/${cleanFile}${lineFrag}`
    }
}
