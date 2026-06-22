"use client"

import {Suspense, useEffect, useState} from "react"
import { useSearchParams } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { AuthShell } from "@/components/auth-shell"
import {registerHyperellipse} from "hyperellipse";

type Provider = "github" | "google" | "apple"

export default function LoginPage() {
    return (
        <Suspense fallback={<LoginShell />}>
            <LoginInner />
        </Suspense>
    )
}

function LoginInner() {
    const params = useSearchParams()
    const next = params.get("next") || "/projects"
    // Which provider is mid-redirect (null = idle). Lets us spin only the
    // button that was clicked while disabling the others.
    const [pending, setPending] = useState<Provider | null>(null)
    const [error, setError] = useState<string | null>(null)

    // Always return to the host the user is actually on — ucelot.com in
    // prod, localhost (with its real port) in dev, a preview URL, etc.
    // Avoids the hardcoded-domain bug that bounced sign-in to the wrong
    // host. (The callback URL still has to be allow-listed in Supabase
    // Auth → URL Configuration.)
    const getUrl = () => new URL("/auth/callback", window.location.origin).href

    async function signIn(provider: Provider) {
        setPending(provider)
        setError(null)
        const supabase = createClient()
        const options: { redirectTo: string; scopes?: string } = {
            redirectTo: `${getUrl()}?next=${encodeURIComponent(next)}`,
        }
        // GitHub is the only provider that grants repo access: `repo` lets
        // the user pick from + analyse their private repositories (GitHub
        // treats it as a superset of public-repo access). Google/Apple are
        // identity-only, so they take the default scopes.
        if (provider === "github") {
            options.scopes = "repo read:user user:email"
        }
        const { error } = await supabase.auth.signInWithOAuth({ provider, options })
        if (error) {
            setError(error.message)
            setPending(null)
        }
    }

    return <LoginShell pending={pending} onSignIn={signIn} error={error} />
}

function LoginShell({
    pending = null,
    onSignIn,
    error,
}: {
    pending?: Provider | null
    onSignIn?: (provider: Provider) => void
    error?: string | null
}) {
    const busy = pending !== null || !onSignIn

    return (
        <AuthShell>
            <h1 className="text-[26px] font-extrabold tracking-[-0.02em]">Welcome back</h1>
            <p className="mt-2 text-[13.5px] leading-6 text-[color:var(--c-text-muted)]">
                Same login as Bobby CI — already signed in there? You&apos;ll land straight inside.
            </p>

            <button
                onClick={() => onSignIn?.("github")}
                disabled={busy}
                suppressHydrationWarning
                className="btn-primary btn-github mt-7 w-full py-3 text-[14px]"
            >
                <GithubMark />
                <span>{pending === "github" ? "Redirecting…" : "Continue with GitHub"}</span>
            </button>

            <div className="my-5 flex items-center gap-3">
                <span className="h-px flex-1 bg-[color:var(--c-border)]" />
                <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[color:var(--c-text-dim)]">
                    or
                </span>
                <span className="h-px flex-1 bg-[color:var(--c-border)]" />
            </div>

            <div className="space-y-2.5">
                <button
                    onClick={() => onSignIn?.("google")}
                    disabled={busy}
                    suppressHydrationWarning
                    className="btn-ghost w-full py-3 text-[13.5px]"
                >
                    <GoogleMark />
                    <span>{pending === "google" ? "Redirecting…" : "Continue with Google"}</span>
                </button>
                <button
                    onClick={() => onSignIn?.("apple")}
                    disabled={busy}
                    suppressHydrationWarning
                    className="btn-ghost w-full py-3 text-[13.5px]"
                >
                    <AppleMark />
                    <span>{pending === "apple" ? "Redirecting…" : "Continue with Apple"}</span>
                </button>
            </div>

            {error && (
                <p className="mt-4 rounded-[10px] bg-rose-50 px-3 py-2 text-[12.5px] text-rose-800">
                    {error}
                </p>
            )}

            <p className="mt-8 text-[12px] leading-5 text-[color:var(--c-text-dim)]">
                By continuing you agree to Ucelot&apos;s terms of service and privacy policy.
            </p>
        </AuthShell>
    )
}

function GithubMark() {
    return (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
            <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.012 8.012 0 0016 8c0-4.42-3.58-8-8-8z" />
        </svg>
    )
}

function GoogleMark() {
    return (
        <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden>
            <path fill="#FFC107" d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z" />
            <path fill="#FF3D00" d="M6.306 14.691l6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z" />
            <path fill="#4CAF50" d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238C29.211 35.091 26.715 36 24 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z" />
            <path fill="#1976D2" d="M43.611 20.083H42V20H24v8h11.303c-.792 2.237-2.231 4.166-4.087 5.571l6.19 5.238C36.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917z" />
        </svg>
    )
}

function AppleMark() {
    return (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
            <path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.51 4.09l-.02-.01zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z" />
        </svg>
    )
}
