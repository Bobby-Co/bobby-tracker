import { NextResponse } from "next/server"
import { requireUser } from "@/lib/server/http/api"
import { createServiceClient } from "@/lib/server/supabase"
import { githubAppClient } from "@/modules/vcs"
import { RepoRef } from "@/modules/vcs"
import type { Project } from "@/lib/shared/types"

// GET /api/github/app/callback — GitHub sends the user here after they install
// (or reconfigure) the "Bobby" App, appending:
//   installation_id  — the new/updated installation
//   setup_action     — "install" | "update" | "request"
//   state            — the projectId we set on the install link
//
// This is a TOP-LEVEL BROWSER NAVIGATION, so it must ALWAYS end in a redirect
// back into the app. Returning a JSON/error body here makes the browser
// *download* the response instead of rendering it (the "downloaded a file
// named github" symptom). Every exit path below is a redirect; force-dynamic
// keeps it from being prerendered or emitted as a static asset.
export const dynamic = "force-dynamic"

export async function GET(request: Request) {
    const url = new URL(request.url)
    const projectId = url.searchParams.get("state")

    // Land the user on the project's Integrations tab (where the sync panel
    // lives), tagging the outcome so the UI can surface it.
    const dest = projectId ? `/projects/${projectId}/integrations` : "/projects"
    const back = (status: "connected" | "error" | "cancelled") => {
        const u = new URL(dest, url.origin)
        u.searchParams.set("github", status)
        return NextResponse.redirect(u)
    }

    try {
        const { supabase, user, error } = await requireUser()
        // No session (e.g. the cookie wasn't sent on the return): send the user
        // through login and back here (mirrors the /login?next= convention).
        if (error || !user) {
            const login = new URL("/login", url.origin)
            login.searchParams.set("next", url.pathname + url.search)
            return NextResponse.redirect(login)
        }

        // "request" = the user asked to install but an org owner must approve;
        // no installation exists yet, so there's nothing to link. Everything
        // else — "install", "update" (re-running the flow on an already-
        // installed app), or a direct re-visit with no action — proceeds to
        // (re)link, so re-triggering the callback works without uninstalling.
        const setupAction = url.searchParams.get("setup_action")
        if (setupAction === "request") return back("cancelled")

        const installationId = Number(url.searchParams.get("installation_id"))
        if (!Number.isFinite(installationId) || installationId <= 0) return back("error")

        const svc = createServiceClient()

        // Capture the account the app was installed on (best-effort).
        let account: { login?: string; type?: string; id?: number } = {}
        const instRes = await githubAppClient.fetch(installationId, "/installation")
        if (instRes.ok) {
            const inst = (await instRes.json().catch(() => null)) as {
                account?: { login?: string; type?: string; id?: number }
            } | null
            account = inst?.account ?? {}
        }

        // Upsert the installation, binding it to the installing user.
        const { error: instErr } = await svc.from("github_installations").upsert(
            {
                installation_id: installationId,
                user_id: user.id,
                account_login: account.login ?? null,
                account_type: account.type ?? null,
                account_id: account.id ?? null,
                suspended_at: null,
                deleted_at: null,
            },
            { onConflict: "installation_id" },
        )
        if (instErr) return back("error")

        // Nothing more to do without a project to link.
        if (!projectId) return back("connected")

        // Load the project (RLS-scoped: caller must own it).
        const { data: project } = await supabase
            .from("projects")
            .select("id,repo_url,repo_full_name")
            .eq("id", projectId)
            .single<Pick<Project, "id" | "repo_url" | "repo_full_name">>()
        if (!project) return back("error")

        // Match the project's repo against the installation's repositories.
        const wantFullName = RepoRef.of(project).fullName()?.toLowerCase() ?? null
        const wantUrl = project.repo_url.replace(/\.git$/, "").replace(/\/+$/, "").toLowerCase()

        const reposRes = await githubAppClient.fetch(installationId, "/installation/repositories")
        if (!reposRes.ok) return back("error")
        const reposBody = (await reposRes.json().catch(() => null)) as {
            repositories?: Array<{ id: number; full_name: string; html_url: string }>
        } | null

        const match = (reposBody?.repositories ?? []).find((r) => {
            if (wantFullName && r.full_name.toLowerCase() === wantFullName) return true
            const rUrl = r.html_url.replace(/\.git$/, "").replace(/\/+$/, "").toLowerCase()
            return rUrl === wantUrl
        })
        if (!match) return back("error")

        // Link the project and turn sync on. Cookie client → RLS confirms ownership.
        await supabase
            .from("projects")
            .update({
                github_installation_id: installationId,
                github_repo_id: match.id,
                github_sync_enabled: true,
            })
            .eq("id", projectId)

        return back("connected")
    } catch {
        // Any unexpected failure (missing env, GitHub API error, etc.) still
        // returns the user to the app rather than a downloaded error body.
        return back("error")
    }
}
