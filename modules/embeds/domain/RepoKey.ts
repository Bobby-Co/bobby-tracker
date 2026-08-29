// Canonical git repository identity — the join key between us and Zoo.
//
// PORTED VERBATIM from Zoo's shared/repo-key.ts, whose own header says to
// mirror it exactly. This is an INTEROP SURFACE, not an internal helper: the
// repo key is hashed into every bearer token we sign, and Zoo re-derives it
// from the `repo` we send. If the two normalizations ever disagree by one
// character, every catalogue read and every mint fails as `bad-signature` — a
// failure that looks like a broken key rather than a string mismatch.
//
// Canonical form: `<host>/<path>`, lowercased, no scheme, no credentials, no
// `.git`, no default port, no trailing slash.
//
// Lowercasing is deliberate: the major hosts treat owner and repo
// case-insensitively, so `Acme/Widgets` and `acme/widgets` are ONE repo.

/** Default ports stripped so `github.com:443/x` and `github.com/x` agree. */
const DEFAULT_PORTS: Record<string, string> = {
    "https:": "443",
    "http:": "80",
    "ssh:": "22",
    "git:": "9418",
}

/** Any git remote → the canonical repo key, or null when it isn't a usable
 *  remote (empty, or no path — e.g. a bare hostname). */
export function normalizeRepoUrl(raw: string | null | undefined): string | null {
    let s = String(raw ?? "").trim()
    if (!s) return null

    let host = ""
    let pathPart = ""

    // scp-like syntax has no scheme and uses `:` to separate host from path:
    //   git@github.com:acme/widgets.git
    // Distinguish from `host:port/path` by requiring a non-numeric first segment.
    const scp = /^(?:([^@/]+)@)?([^:/@]+):(?!\/)(.+)$/.exec(s)
    if (scp && !/^\d+(?:\/|$)/.test(scp[3])) {
        host = scp[2]
        pathPart = scp[3]
    } else {
        // Give a scheme-less value one so the URL parser can take it.
        if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = "ssh://" + s
        let u: URL
        try {
            u = new URL(s)
        } catch {
            return null
        }
        host = u.hostname
        if (u.port && u.port !== DEFAULT_PORTS[u.protocol]) host += ":" + u.port
        pathPart = u.pathname
    }

    // Strip credentials that survived the scp branch, and tidy the path.
    host = host.replace(/^[^@]*@/, "")
    pathPart = pathPart
        .replace(/^\/+/, "")
        .replace(/\/+$/, "")
        .replace(/\.git$/i, "")

    if (!host || !pathPart) return null
    return `${host}/${pathPart}`.toLowerCase()
}
