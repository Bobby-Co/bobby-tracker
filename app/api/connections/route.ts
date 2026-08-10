import { ApiContext, jsonError } from "@/lib/server/http/api"

// GET /api/connections
//
// Account-level VCS connection status for the Settings → Connections page.
// Reports, per provider, whether the signed-in user has a usable stored OAuth
// token and the login to show ("connected as @user"). GitHub reads from
// github_tokens (githubTokens repo); GitLab from provider_tokens (providerTokens
// repo, migration 0055). Connecting/disconnecting is handled elsewhere — this is
// read-only status.
export async function GET() {
    const { ctx, user, error } = await new ApiContext().requireUser()
    if (error) return error

    try {
        const [github, gitlab] = await Promise.all([
            ctx.githubTokens.find(user.id),
            ctx.providerTokens.find(user.id, "gitlab"),
        ])
        return Response.json({
            providers: {
                github: { connected: !!github, login: github?.login ?? null },
                gitlab: { connected: !!gitlab, login: gitlab?.login ?? null },
            },
        })
    } catch (e) {
        return jsonError("db_error", (e as Error).message, 500)
    }
}
