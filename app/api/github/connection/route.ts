import { jsonError, requireUser } from "@/lib/api"
import { getUserGithubToken } from "@/lib/github-user"

// GET /api/github/connection
//
// Lightweight "can this user comment as themselves?" check for the comment
// composers: true only when the user has a stored GitHub token with `repo`
// scope (same policy as /api/github/repos). Returns their GitHub login for the
// "connected as @octocat" affordance.
export async function GET() {
    const { supabase, user, error } = await requireUser()
    if (error) return error

    try {
        const gh = await getUserGithubToken(supabase, user.id)
        return Response.json({ connected: !!gh, login: gh?.login ?? null })
    } catch (e) {
        return jsonError("db_error", (e as Error).message, 500)
    }
}
