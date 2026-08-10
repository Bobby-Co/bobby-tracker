import { ApiContext, jsonError } from "@/lib/server/http/api"

// GET /api/connections
//
// Account-level VCS connection status for the Settings → Connections page.
// GitHub is a single connection (github.com, via github_tokens). GitLab is a
// LIST: because this is a public service, a user can connect gitlab.com (OAuth)
// and any number of self-managed instances (PAT), each its own row keyed by host
// (provider_tokens, migration 0055). Read-only status; connect/disconnect live
// on the sibling routes.
export async function GET() {
    const { ctx, user, error } = await new ApiContext().requireUser()
    if (error) return error

    try {
        const [github, gitlab] = await Promise.all([
            ctx.githubTokens.find(user.id),
            ctx.providerTokens.list(user.id),
        ])
        return Response.json({
            providers: {
                github: { connected: !!github, login: github?.login ?? null },
                gitlab: { connections: gitlab },
            },
        })
    } catch (e) {
        return jsonError("db_error", (e as Error).message, 500)
    }
}
