// Validation for user-supplied git repo URLs.
//
// These URLs are forwarded to the analyser, which clones them SERVER-SIDE.
// An unrestricted URL is therefore an SSRF-by-proxy vector: a user could
// point the analyser's git clone at internal/cloud-metadata addresses or at
// a non-https transport. We enforce https-only and block hosts that resolve
// to the analyser's own network position. (The analyser re-validates and
// additionally does DNS-resolution checks — this is the first gate, kept
// here so creation fails fast with a clear message.)
//
// We deliberately do NOT hard-restrict to github.com: the app supports
// GitHub Enterprise / self-hosted git hosts. Operators who want a strict
// allowlist set BOBBY_ALLOWED_GIT_HOSTS on the analyser.

export type RepoUrlCheck = { ok: true; url: string } | { ok: false; message: string }

// Literal-IP and hostname forms that must never be cloned. DNS-name → internal
// IP rebinding is caught by the analyser's resolution check; here we block the
// obvious literal and suffix forms that need no resolution.
function isBlockedHost(host: string): boolean {
    const h = host.toLowerCase().replace(/^\[|\]$/g, "") // strip IPv6 brackets

    if (
        h === "localhost" ||
        h.endsWith(".localhost") ||
        h.endsWith(".local") ||
        h.endsWith(".internal") ||
        h === "metadata.google.internal"
    ) {
        return true
    }

    // IPv4 literal → block loopback / private / link-local / unspecified.
    const v4 = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
    if (v4) {
        const [a, b] = [Number(v4[1]), Number(v4[2])]
        if (a === 127) return true // 127.0.0.0/8 loopback
        if (a === 10) return true // 10.0.0.0/8
        if (a === 0) return true // 0.0.0.0/8 unspecified
        if (a === 169 && b === 254) return true // 169.254.0.0/16 link-local (incl. cloud metadata 169.254.169.254)
        if (a === 172 && b >= 16 && b <= 31) return true // 172.16.0.0/12
        if (a === 192 && b === 168) return true // 192.168.0.0/16
        if (a === 100 && b >= 64 && b <= 127) return true // 100.64.0.0/10 CGNAT
        return false
    }

    // IPv6 loopback / unspecified / unique-local / link-local literals.
    if (h === "::1" || h === "::" || h.startsWith("fc") || h.startsWith("fd") || h.startsWith("fe80")) {
        return true
    }

    return false
}

export function validateRepoUrl(raw: string): RepoUrlCheck {
    const s = String(raw ?? "").trim()
    if (!s) return { ok: false, message: "repo_url is required" }

    let u: URL
    try {
        u = new URL(s)
    } catch {
        return { ok: false, message: "repo_url is not a valid URL" }
    }

    if (u.protocol !== "https:") {
        return { ok: false, message: "repo_url must use https://" }
    }
    if (u.username || u.password) {
        return { ok: false, message: "repo_url must not embed credentials" }
    }
    if (!u.hostname) {
        return { ok: false, message: "repo_url is missing a host" }
    }
    if (isBlockedHost(u.hostname)) {
        return { ok: false, message: "repo_url host is not allowed" }
    }

    return { ok: true, url: s }
}
