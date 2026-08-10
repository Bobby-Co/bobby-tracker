import { NextResponse } from "next/server"
import { Supabase } from "@/lib/server/supabase"
import { BetaAccess } from "@/lib/shared/BetaAccess"
import { createProviderTokenRepository } from "@/modules/vcs"

// Supabase OAuth callback. Exchanges the `code` query param for a session,
// captures the GitHub provider token (so the app can later list private
// repos and authorise the analyser's git clone), then redirects to
// ?next=… (defaults to /projects).
//
// provider_token is only present on the session returned from
// exchangeCodeForSession — Supabase doesn't refresh it or expose it on
// subsequent loads. If we want it later we have to persist it ourselves.
//
// Failure handling matters here: this route is the *only* place the
// add-project reconnect flow can refresh a rejected GitHub token. If we
// swallow errors and redirect to /projects regardless, the user lands in
// an invisible loop (reconnect → bounce → token still bad → reconnect).
// So every failure is either surfaced on /login or flagged on the
// redirect URL, and logged for Cloudflare's tail.
export async function GET(request: Request) {
    const url = new URL(request.url)
    const code = url.searchParams.get("code")

    // Open-redirect guard: only honor same-origin relative paths.
    const rawNext = url.searchParams.get("next")
    const next = rawNext && rawNext.startsWith("/") && !rawNext.startsWith("//") ? rawNext : "/projects"

    // Supabase appends ?error=…&error_description=… when the OAuth dance
    // fails upstream (user denied, provider error, or — most commonly here
    // — the redirect URL isn't allow-listed in Auth → URL Configuration,
    // so there's no code to exchange). Surface it on /login instead of
    // silently bouncing to /projects.
    const oauthError = url.searchParams.get("error_description") || url.searchParams.get("error")
    if (oauthError) {
        console.error("[auth/callback] OAuth error from provider:", oauthError)
        const errUrl = new URL("/login", url.origin)
        errUrl.searchParams.set("error", oauthError)
        return NextResponse.redirect(errUrl)
    }

    // No code and no error means we were reached without an OAuth round-
    // trip (e.g. a stray navigation). Nothing to exchange — send the user
    // on, but log it so it isn't a silent dead-end.
    if (!code) {
        console.warn("[auth/callback] reached without a code or error param")
        return NextResponse.redirect(new URL(next, url.origin))
    }

    const supabase = await Supabase.rls()
    const { data, error } = await supabase.auth.exchangeCodeForSession(code)
    if (error) {
        console.error("[auth/callback] exchangeCodeForSession failed:", error.message)
        const errUrl = new URL("/login", url.origin)
        errUrl.searchParams.set("error", error.message)
        return NextResponse.redirect(errUrl)
    }

    const session = data?.session
    const user = data?.user
    const accessToken = session?.provider_token

    // Our own "Connect GitLab" flow (Settings → Connections) sets ?connect=gitlab
    // on the callback URL. We can't infer the provider from app_metadata.provider
    // here: a user who first signed in with GitHub keeps provider === "github"
    // even while linking GitLab, so without this hint the GitLab token would be
    // mis-written into github_tokens below. The hint is our own redirect param,
    // not attacker-controlled provider data.
    const connectProvider = url.searchParams.get("connect")

    // Capture the GitLab OAuth token into provider_tokens (migration 0055). Only
    // on our explicit connect flow, so a plain GitHub sign-in never reaches here.
    if (user && connectProvider === "gitlab") {
        if (!accessToken) {
            console.warn("[auth/callback] no provider_token on GitLab connect")
            const dest = new URL(next, url.origin)
            dest.searchParams.set("gitlab", "connect_failed")
            return NextResponse.redirect(dest)
        }
        const identity = user.identities?.find((i) => i.provider === "gitlab")
        const data = identity?.identity_data as
            | { nickname?: string; preferred_username?: string; user_name?: string }
            | undefined
        const login = data?.nickname ?? data?.preferred_username ?? data?.user_name ?? null
        // GitLab access tokens expire (~2h); Supabase doesn't expose the exact
        // expiry, so store a conservative one and let the read-side refresh via
        // the refresh_token when it lapses.
        const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString()
        try {
            // OAuth is only brokered for public gitlab.com (Supabase's single
            // GitLab provider); self-managed instances connect via PAT paste.
            await createProviderTokenRepository(supabase).upsert(user.id, "gitlab.com", {
                authKind: "oauth",
                accessToken,
                refreshToken: session?.provider_refresh_token ?? null,
                expiresAt,
                scopes: null,
                providerUserId: identity?.id ?? null,
                login,
                apiBase: null,
            })
        } catch (e) {
            console.error("[auth/callback] provider_tokens (gitlab) upsert failed:", (e as Error).message)
            const dest = new URL(next, url.origin)
            dest.searchParams.set("gitlab", "connect_failed")
            return NextResponse.redirect(dest)
        }
        // Fall through to the onboarding/beta/redirect logic (an already
        // signed-in user connecting GitLab just lands back on `next`).
    }

    // Only GitHub sign-ins need a provider token captured (for repo access).
    // Google/Apple are identity-only and may return no provider_token at all
    // (Apple typically doesn't), so running the GitHub-token logic for them
    // would wrongly flag `reconnect_failed` or stash a non-GitHub token in
    // `github_tokens`. Skip straight to the app for those providers. The GitLab
    // connect flow is handled above, never as a GitHub sign-in.
    const isGithub = connectProvider !== "gitlab" && user?.app_metadata?.provider === "github"

    // Reached here when the user authenticated but GitHub didn't return a
    // provider token (Supabase only includes it on a fresh grant). The
    // session is valid, but the add-project picker will still 401 — flag
    // it on the redirect so the failure isn't invisible.
    if (user && isGithub && !accessToken) {
        console.warn("[auth/callback] no provider_token on session; GitHub token not refreshed")
        const dest = new URL(next, url.origin)
        dest.searchParams.set("github", "reconnect_failed")
        return NextResponse.redirect(dest)
    }

    if (user && isGithub && accessToken) {
        const identity = user.identities?.find((i) => i.provider === "github")
        const providerUserId = identity?.id ?? null
        const providerLogin =
            (identity?.identity_data as { user_name?: string } | undefined)?.user_name ?? null

        // GitHub returns the granted OAuth scopes in the
        // X-OAuth-Scopes header on any authenticated request.
        // Storing them lets the add-project form decide whether
        // to prompt for re-consent when `repo` is missing.
        let scopes: string | null = null
        try {
            const probe = await fetch("https://api.github.com/user", {
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    Accept: "application/vnd.github+json",
                    // Required — Cloudflare Workers' fetch sends no User-Agent
                    // and GitHub 403s without one (see api/github/repos).
                    "User-Agent": "ucelot-tracker",
                },
            })
            scopes = probe.headers.get("x-oauth-scopes")
        } catch {
            // Non-fatal — leave scopes null.
        }

        const { error: upsertErr } = await supabase.from("github_tokens").upsert(
            {
                user_id: user.id,
                access_token: accessToken,
                refresh_token: session?.provider_refresh_token ?? null,
                scopes,
                provider_user_id: providerUserId,
                provider_login: providerLogin,
            },
            { onConflict: "user_id" },
        )
        // A failed upsert means the rejected token stays in place and the
        // user loops. We can't recover here, but we must not pretend it
        // worked — log it and flag the redirect.
        if (upsertErr) {
            console.error("[auth/callback] github_tokens upsert failed:", upsertErr.message)
            const dest = new URL(next, url.origin)
            dest.searchParams.set("github", "reconnect_failed")
            return NextResponse.redirect(dest)
        }
    }

    // Onboarding comes first — before the beta gate — so every brand-new
    // user (no `onboarded` flag yet) completes the in-panel wizard, even the
    // ones who'll land on the waitlist afterwards. The wizard persists the
    // flag (so this only fires once) and then routes on to the app or the
    // waitlist. `next` is carried through so it can hand off where the user
    // was originally headed.
    if (user && !user.user_metadata?.onboarded) {
        const dest = new URL("/onboarding", url.origin)
        dest.searchParams.set("next", next)
        return NextResponse.redirect(dest)
    }

    // Beta gate: onboarded users who aren't on the whitelist land on the
    // coming-soon page instead of the app.
    if (user && !new BetaAccess().isAllowed(user)) {
        return NextResponse.redirect(new URL("/waitlist", url.origin))
    }

    return NextResponse.redirect(new URL(next, url.origin))
}
