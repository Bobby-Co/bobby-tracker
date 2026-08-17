import { after } from "next/server"
import { ApiContext, jsonError, repoRead } from "@/lib/server/http/api"
import { tryOrNull } from "@/lib/shared/kernel"
import { getAnalyser } from "@/modules/analysis"
import { filterIconsLocal } from "@/lib/shared/icons/suggest"
import { canonicalRepoUrl, validateRepoUrl } from "@/lib/shared/repo-url"
import { Supabase } from "@/lib/server/supabase"

// GET — list the ACTIVE TEAM's projects, newest first. Backs the app sidebar and
// the /projects grid. Coarse RLS already scopes rows to teams the caller belongs
// to; here we (a) pin to the active team and (b) apply the group-level gate that
// RLS deliberately doesn't — a plain member sees only projects granted to a group
// they're in (owner/admin see all team projects). See modules/access.
//
// ?stats=1 embeds each project's insight row (0047) so the grid can render its
// tile footers from the same round-trip. The sidebar calls the plain form and
// pays nothing for stats it never shows.
export async function GET(request: Request) {
    const { ctx, user, teamId, role, error } = await new ApiContext(request).requireTeam()
    if (error) return error

    const withStats = new URL(request.url).searchParams.get("stats") === "1"

    const accessible = await ctx.access.accessibleProjectIds(teamId, user.id, role)
    // A member with no group grants sees nothing — short-circuit the query.
    if (Array.isArray(accessible) && accessible.length === 0) {
        return Response.json({ projects: [] })
    }

    if (!withStats) {
        const { data: projects, error: dbErr } = await repoRead(() => ctx.projects.listForTeam(teamId, accessible))
        if (dbErr) return dbErr
        return Response.json({ projects })
    }

    const { data: projects, error: dbErr } = await repoRead(() => ctx.projects.listForTeamWithInsight(teamId, accessible))
    if (dbErr) return dbErr
    return Response.json({ projects })
}

export async function POST(request: Request) {
    const { ctx, user, teamId, role, error } = await new ApiContext(request).requireTeam()
    if (error) return error
    // Adding a project to a team is an admin action. In a personal team the sole
    // member is the owner, so this is transparent for solo use.
    const roleErr = new ApiContext().requireRole(role, "admin")
    if (roleErr) return roleErr

    let body: Record<string, unknown>
    try { body = await request.json() } catch { return jsonError("bad_request", "invalid JSON", 400) }

    const name = String(body?.name ?? "").trim()
    const repo_url = String(body?.repo_url ?? "").trim()
    const description = body?.description ? String(body.description) : null
    const repo_full_name_from_client =
        typeof body?.repo_full_name === "string" && body.repo_full_name
            ? String(body.repo_full_name).trim()
            : null

    if (!name) return jsonError("bad_request", "name is required", 400)
    // repo_url is cloned server-side by the analyser — validate against SSRF
    // (internal/loopback hosts) and non-https transports before storing it.
    const repoCheck = validateRepoUrl(repo_url)
    if (!repoCheck.ok) return jsonError("bad_request", repoCheck.message, 400)

    // Trust the picker's owner/repo when it sent one (saves a re-parse
    // and works for repo URLs that the regex below doesn't match, like
    // GitHub Enterprise hosts); otherwise fall back to URL inference.
    const repo_full_name = repo_full_name_from_client ?? inferGithubFullName(repo_url)

    // Canonicalise the URL so trivial variants (…/bar, …/bar.git, …/bar/,
    // www., host case) can't create "different" projects for the same repo.
    const canonical_url = canonicalRepoUrl(repo_url)

    // Reject a repo the TEAM already has. The DB's unique(team_id, repo_url)
    // constraint (0052) only catches an EXACT string match, so we also compare by
    // canonical URL and by repo_full_name case-insensitively (a repo's real
    // identity). Scope the select to the active team.
    const mine = (await tryOrNull(() => ctx.projects.listRepoRefsForTeam(teamId))) ?? []
    const already = mine.some((p) => {
        if (canonicalRepoUrl(p.repo_url).toLowerCase() === canonical_url.toLowerCase()) return true
        if (repo_full_name && p.repo_full_name && p.repo_full_name.toLowerCase() === repo_full_name.toLowerCase()) return true
        return false
    })
    if (already) {
        return jsonError("conflict", "This team already has a project for this repository.", 409)
    }

    const { data: result, error: dbErr } = await repoRead(() =>
        ctx.projects.create({ team_id: teamId, user_id: user.id, name, repo_url: canonical_url, repo_full_name, description }),
    )
    if (dbErr) return dbErr
    // Backstop for the pre-check race — the unique(team_id, repo_url) index.
    if (!result.ok) return jsonError("conflict", "This team already has a project for this repository.", 409)
    const project = result.project

    // Auto-assign the top suggested icon so a fresh project isn't a faceless
    // hash glyph. Post-response (after()) since it may embed — creation must not
    // wait on a metered call — and best-effort: any failure just leaves the icon
    // unset, and the user can still pick one in settings. The seed is the
    // description (says the most about the project), falling back to the name.
    const iconSeed = (description ?? "").trim() || name
    after(async () => {
        try {
            const icon = await topSuggestedIcon(iconSeed)
            if (!icon) return
            const svc = Supabase.service()
            const { error: iconErr } = await svc.from("projects").update({ icon_name: icon }).eq("id", project.id)
            if (iconErr) console.error("[project create] auto-icon update failed", project.id, iconErr.message)
        } catch (e) {
            console.error("[project create] auto-icon failed", project.id, e)
        }
    })

    return Response.json({ project })
}

// Top-ranked icon for a piece of text, mirroring the picker's ordering: a local
// slug/tag match wins (it's canonical); otherwise fall back to the semantic
// embedding ranking (the same find_similar_icons RPC /api/icons/search uses).
async function topSuggestedIcon(seed: string): Promise<string | null> {
    const text = seed.trim()
    if (!text) return null
    const local = filterIconsLocal(text)
    if (local.length > 0) return local[0].name
    const { vector } = await getAnalyser().embed(text)
    const svc = Supabase.service()
    const { data } = await svc.rpc("find_similar_icons", {
        p_embedding: vector as unknown as string,
        p_limit: 1,
    })
    const hits = (data ?? []) as { name: string }[]
    return hits[0]?.name ?? null
}

function inferGithubFullName(url: string): string | null {
    const m = url.match(/^https?:\/\/(?:www\.)?github\.com\/([^\/]+\/[^\/]+?)(?:\.git)?\/?$/)
    return m ? m[1] : null
}
