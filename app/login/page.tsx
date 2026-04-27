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

const BobbyMark = () => (
  <svg width={36} height={36} viewBox="0 0 106 102" xmlns="http://www.w3.org/2000/svg">
      <path
        fill="black"
        d="M 95.59375 67.023438 L 95.609375 17.179688 C 95.610001 12.229996 91.550003 8.239998 86.589996 8.339996 C 81.720001 8.43 77.919998 12.610001 77.919998 17.470001 L 77.921875 32.132813 C 77.919998 36.360001 74.559998 39.91 70.330002 39.950001 L 68.539063 39.84375 C 64.690002 39.32 61.84 35.979996 61.84 32.089996 L 61.84375 18.078125 C 61.84 14.139999 59.560001 10.470001 55.919998 8.959999 C 52.259998 7.440002 49.66 9.010002 47.189999 10.520004 C 44.529999 12.129997 36.509998 16.379997 36.509998 16.379997 L 36.03125 16.640625 L 35.546875 16.382813 C 35.549999 16.379997 27.440001 12.099998 25.32 10.770004 C 22.82 9.199997 20.280001 7.440002 16.540001 8.870003 C 12.78 10.309998 10.39 14.050003 10.39 18.089996 L 10.390625 67.023438 C 10.84 79.970001 21.459999 90.339996 34.509998 90.339996 L 71.492188 90.34375 C 84.540001 90.339996 95.160004 79.970001 95.59375 67.023438 Z M 23.25 40.460938 C 21.219999 39.689999 19.780001 37.729996 19.780001 35.419998 C 19.780001 33.110001 21.219999 31.150002 23.25 30.370003 C 23.860001 30.129997 24.52 30 25.200001 30 C 26.26 30 27.24 30.309998 28.08 30.839996 C 29.6 31.800003 30.610001 33.490005 30.610001 35.419998 C 30.610001 37.349998 29.6 39.049999 28.08 40 C 27.24 40.529999 26.26 40.830002 25.200001 40.830002 C 24.52 40.830002 23.860001 40.700001 23.25 40.460938 Z M 44.15625 39.609375 C 42.939999 38.619999 42.169998 37.110001 42.169998 35.419998 C 42.169998 33.729996 42.939999 32.220001 44.16 31.229996 C 45.09 30.459999 46.279999 30 47.580002 30 C 49.07 30 50.41 30.599998 51.389999 31.57 C 52.389999 32.559998 53 33.919998 53 35.419998 C 53 36.93 52.389999 38.279999 51.389999 39.259998 C 50.41 40.240002 49.07 40.830002 47.580002 40.830002 C 46.279999 40.830002 45.09 40.369999 44.15625 39.609375 Z M 34.507813 81.492188 C 26.360001 81.489998 19.68 75.07 19.26 67.019997 L 29.6875 67.023438 L 29.6875 60.148438 C 29.690001 58.169998 31.290001 56.57 33.27 56.57 L 42.1875 56.570313 C 44.169998 56.57 45.77 58.169998 45.77 60.150002 L 45.773438 67.023438 L 58.632813 67.023438 L 58.632813 60.148438 C 58.630001 58.169998 60.23 56.57 62.209999 56.57 L 71.132813 56.570313 C 73.110001 56.57 74.709999 58.169998 74.709999 60.150002 L 74.710938 67.023438 L 86.742188 67.023438 C 86.32 75.07 79.639999 81.489998 71.489998 81.489998 Z"
      />
  </svg>
)

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
                    <BobbyMark/>
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
