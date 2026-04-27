"use client"

import { Suspense, useState } from "react"
import { useSearchParams } from "next/navigation"
import { createClient } from "@/lib/supabase/client"

export default function LoginPage() {
    return (
        <Suspense fallback={<LoginShell pending />}>
            <LoginInner />
        </Suspense>
    )
}

function LoginInner() {
    const params = useSearchParams()
    const next = params.get("next") || "/projects"
    const [pending, setPending] = useState(false)
    const [error, setError] = useState<string | null>(null)

    async function signIn() {
        setPending(true)
        setError(null)
        const supabase = createClient()
        const { error } = await supabase.auth.signInWithOAuth({
            provider: "github",
            options: {
                redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
                scopes: "read:user user:email",
            },
        })
        if (error) {
            setError(error.message)
            setPending(false)
        }
    }

    return <LoginShell pending={pending} onSignIn={signIn} error={error} />
}

function LoginShell({
    pending,
    onSignIn,
    error,
}: {
    pending: boolean
    onSignIn?: () => void
    error?: string | null
}) {
    return (
        <div className="dotted-bg flex min-h-screen flex-col items-center justify-center px-6">
            <div
                className="w-full max-w-sm rounded-[20px] border border-[color:var(--c-border)] bg-white p-7 shadow-[var(--shadow-card)]"
            >
                <div className="flex items-center gap-3">
                    <span
                        aria-hidden
                        className="grid h-9 w-9 place-items-center rounded-[10px] bg-zinc-900"
                        style={{ color: "#a3e635" }}
                    >
                        <svg viewBox="0 0 106 102" width="22" height="22" fill="none">
                            <path d="M14 22 C14 12 22 4 32 4 H74 C84 4 92 12 92 22 V70 C92 86 80 98 64 98 H42 C26 98 14 86 14 70 Z" fill="currentColor" />
                            <circle cx="40" cy="46" r="9" fill="#080808" />
                            <circle cx="68" cy="46" r="9" fill="#080808" />
                        </svg>
                    </span>
                    <div>
                        <div className="text-[10.5px] font-bold uppercase tracking-[0.18em] text-[color:var(--c-text-muted)]">
                            Bobby
                        </div>
                        <div className="text-[16px] font-bold leading-tight">Tracker</div>
                    </div>
                </div>

                <h1 className="mt-6 text-[20px] font-bold tracking-[-0.012em]">Sign in</h1>
                <p className="mt-1 text-[13px] text-[color:var(--c-text-muted)]">
                    Same login as Bobby CI — already signed in there? You&apos;ll land straight inside.
                </p>

                <button
                    onClick={onSignIn}
                    disabled={pending || !onSignIn}
                    className="btn-primary mt-6 w-full py-2.5"
                >
                    <GithubMark />
                    <span>{pending ? "Redirecting…" : "Continue with GitHub"}</span>
                </button>

                {error && (
                    <p className="mt-4 rounded-[10px] bg-rose-50 px-3 py-2 text-[12.5px] text-rose-800">
                        {error}
                    </p>
                )}
            </div>
        </div>
    )
}

function GithubMark() {
    return (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
            <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.012 8.012 0 0016 8c0-4.42-3.58-8-8-8z" />
        </svg>
    )
}
