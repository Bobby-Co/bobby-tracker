import { ApiContext, jsonError } from "@/lib/server/http/api"

// DELETE /api/connections/[provider] — disconnect a VCS provider.
//
// Drops the stored OAuth credential for the signed-in user: GitHub from
// github_tokens, GitLab from provider_tokens. Idempotent (removing an absent
// row is success). The provider's login IDENTITY is untouched — only the stored
// repo-access token is removed, so the user can reconnect later.
export async function DELETE(_: Request, { params }: { params: Promise<{ provider: string }> }) {
    const { provider } = await params
    const { ctx, user, error } = await new ApiContext().requireUser()
    if (error) return error

    try {
        if (provider === "github") {
            await ctx.githubTokens.remove(user.id)
        } else if (provider === "gitlab") {
            await ctx.providerTokens.remove(user.id, "gitlab")
        } else {
            return jsonError("bad_provider", `unknown provider '${provider}'`, 400)
        }
        return Response.json({ ok: true })
    } catch (e) {
        return jsonError("db_error", (e as Error).message, 500)
    }
}
