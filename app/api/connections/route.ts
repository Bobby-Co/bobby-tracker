import { ApiContext, jsonError } from "@/lib/server/http/api"

// GET /api/connections
//
// Account-level VCS connection status for the Settings → Connections page.
// GitHub is a single connection (github.com, via github_tokens). GitLab is a
// LIST: because this is a public service, a user can connect gitlab.com (OAuth)
// and any number of self-managed instances (PAT), each its own row keyed by host
// (provider_tokens, migration 0055). Read-only status; connect/disconnect live
// on the sibling routes.

// Ask GitHub whether the stored token still works. A stored row is not the same
// thing as a working connection: GitHub revokes tokens (the user withdraws the
// authorisation, the grant is replaced, a long-idle token lapses) and nothing
// tells us. Reporting row-existence as "Connected" is what left the repo picker
// silently empty with no way back — this page's whole job is to say otherwise.
//
// Fail OPEN: only an explicit 401/403 means the credential is dead. A timeout or
// a GitHub outage must not tell the user to reconnect a connection that is fine.
async function githubTokenIsLive(token: string): Promise<boolean> {
    try {
        const res = await fetch("https://api.github.com/user", {
            headers: {
                Authorization: `Bearer ${token}`,
                Accept: "application/vnd.github+json",
                // Workers' fetch sends no User-Agent and GitHub 403s without one.
                "User-Agent": "ucelot-tracker",
            },
            cache: "no-store",
        })
        return res.status !== 401 && res.status !== 403
    } catch {
        return true
    }
}

export async function GET() {
    const { ctx, user, error } = await new ApiContext().requireUser()
    if (error) return error

    try {
        const [github, gitlab] = await Promise.all([
            ctx.githubTokens.find(user.id),
            ctx.providerTokens.list(user.id),
        ])
        const githubStale = github ? !(await githubTokenIsLive(github.token)) : false
        return Response.json({
            providers: {
                github: { connected: !!github, login: github?.login ?? null, stale: githubStale },
                gitlab: { connections: gitlab },
            },
        })
    } catch (e) {
        return jsonError("db_error", (e as Error).message, 500)
    }
}
