import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

// Supabase OAuth callback. Exchanges the `code` query param for a session,
// captures the GitHub provider token (so the app can later list private
// repos and authorise the analyser's git clone), then redirects to
// ?next=… (defaults to /projects).
//
// provider_token is only present on the session returned from
// exchangeCodeForSession — Supabase doesn't refresh it or expose it on
// subsequent loads. If we want it later we have to persist it ourselves.
export async function GET(request: Request) {
    const url = new URL(request.url)
    const code = url.searchParams.get("code")
    const next = url.searchParams.get("next") || "/projects"

    if (code) {
        const supabase = await createClient()
        const { data, error } = await supabase.auth.exchangeCodeForSession(code)
        if (error) {
            const errUrl = new URL("/login", url.origin)
            errUrl.searchParams.set("error", error.message)
            return NextResponse.redirect(errUrl)
        }

        const session = data?.session
        const user = data?.user
        const accessToken = session?.provider_token
        if (user && accessToken) {
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
                    },
                })
                scopes = probe.headers.get("x-oauth-scopes")
            } catch {
                // Non-fatal — leave scopes null.
            }

            // Best-effort: failure here shouldn't block sign-in. The
            // user can hit "Reconnect GitHub" from the add-project
            // form if the row never lands.
            await supabase.from("github_tokens").upsert(
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
        }
    }
    return NextResponse.redirect(new URL(next, url.origin))
}
