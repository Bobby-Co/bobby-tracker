import { ApiContext, jsonError } from "@/lib/server/http/api"

// Per-provider connection actions for the Settings → Connections page.
//
//   POST   /api/connections/gitlab              — connect a self-managed GitLab
//                                                  instance by pasting a PAT.
//   DELETE /api/connections/github              — disconnect GitHub.
//   DELETE /api/connections/gitlab?host=<host>  — disconnect one GitLab instance.
//
// PAT connect is the only mechanism that works across ARBITRARY GitLab instances
// (OAuth can't be brokered to an unknown host), so it's how self-hosted users of
// this public service connect. gitlab.com users use the OAuth flow instead.

const USER_AGENT = "ucelot-tracker"

// We fetch the pasted instance server-side to validate the token, so the host is
// an SSRF vector — block loopback / private / link-local literals and the
// obvious internal names. (DNS-name → internal-IP rebinding isn't caught here;
// this is a first gate, mirroring lib repo-url validation.)
function isBlockedHost(h: string): boolean {
    if (
        h === "localhost" ||
        h.endsWith(".localhost") ||
        h.endsWith(".local") ||
        h.endsWith(".internal") ||
        h === "metadata.google.internal"
    ) {
        return true
    }
    const v4 = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
    if (v4) {
        const a = Number(v4[1])
        const b = Number(v4[2])
        if (a === 127 || a === 10 || a === 0) return true
        if (a === 169 && b === 254) return true
        if (a === 172 && b >= 16 && b <= 31) return true
        if (a === 192 && b === 168) return true
        if (a === 100 && b >= 64 && b <= 127) return true
        return false
    }
    if (h === "::1" || h === "::" || h.startsWith("fc") || h.startsWith("fd") || h.startsWith("fe80")) {
        return true
    }
    return false
}

// Accept "gitlab.acme.com" or "https://gitlab.acme.com/" → { host, apiBase }.
function normalizeHost(input: string): { host: string; apiBase: string } | null {
    let raw = input.trim()
    if (!raw) return null
    if (!/^https?:\/\//i.test(raw)) raw = `https://${raw}`
    let u: URL
    try {
        u = new URL(raw)
    } catch {
        return null
    }
    const host = u.hostname.toLowerCase()
    if (!host || isBlockedHost(host)) return null
    return { host, apiBase: `https://${host}/api/v4` }
}

export async function POST(req: Request, { params }: { params: Promise<{ provider: string }> }) {
    const { provider } = await params
    if (provider !== "gitlab") {
        return jsonError("bad_provider", "PAT connect is GitLab-only", 400)
    }
    const { ctx, user, error } = await new ApiContext().requireUser()
    if (error) return error

    const body = (await req.json().catch(() => null)) as { host?: string; token?: string } | null
    const token = body?.token?.trim()
    if (!token) return jsonError("bad_request", "token is required", 400)
    const norm = normalizeHost(body?.host ?? "")
    if (!norm) return jsonError("bad_request", "a valid GitLab host is required", 400)

    // Validate the token against the instance + capture the login. GitLab
    // accepts the PAT as a Bearer token; Workers' fetch needs an explicit UA.
    let who: { id?: number; username?: string } | null = null
    try {
        const res = await fetch(`${norm.apiBase}/user`, {
            headers: { Authorization: `Bearer ${token}`, "User-Agent": USER_AGENT },
            cache: "no-store",
        })
        if (res.status === 401 || res.status === 403) {
            return jsonError("gitlab_unauthorized", `${norm.host} rejected the token.`, 401)
        }
        if (!res.ok) {
            return jsonError("gitlab_error", `GitLab ${res.status} from ${norm.host}`, 502)
        }
        who = (await res.json().catch(() => null)) as { id?: number; username?: string } | null
    } catch (e) {
        return jsonError("gitlab_unreachable", `Could not reach ${norm.host}: ${(e as Error).message}`, 502)
    }

    try {
        await ctx.providerTokens.upsert(user.id, norm.host, {
            authKind: "pat",
            accessToken: token,
            refreshToken: null,
            expiresAt: null,
            scopes: null,
            providerUserId: who?.id != null ? String(who.id) : null,
            login: who?.username ?? null,
            apiBase: norm.apiBase,
        })
    } catch (e) {
        return jsonError("db_error", (e as Error).message, 500)
    }
    return Response.json({ ok: true, host: norm.host, login: who?.username ?? null })
}

export async function DELETE(req: Request, { params }: { params: Promise<{ provider: string }> }) {
    const { provider } = await params
    const { ctx, user, error } = await new ApiContext().requireUser()
    if (error) return error

    try {
        if (provider === "github") {
            await ctx.githubTokens.remove(user.id)
        } else if (provider === "gitlab") {
            const host = new URL(req.url).searchParams.get("host")
            if (!host) return jsonError("bad_request", "host query param is required", 400)
            await ctx.providerTokens.remove(user.id, host)
        } else {
            return jsonError("bad_provider", `unknown provider '${provider}'`, 400)
        }
        return Response.json({ ok: true })
    } catch (e) {
        return jsonError("db_error", (e as Error).message, 500)
    }
}
