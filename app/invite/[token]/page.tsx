"use client"

import { use, useState } from "react"
import Link from "next/link"
import { useAuth } from "@/lib/auth/auth-context"
import { useApi } from "@/lib/hooks/use-api"
import { ApiError, apiMutate } from "@/lib/api-client"

interface InviteInfo {
    email: string
    role: string
    team_name: string
}

// Standalone invite-accept page (outside the authed app shell). Shows the invite,
// routes a signed-out visitor to /login?next=…, and on accept joins the team and
// drops the visitor into it. Both handlers below are server-enforced — the email
// must match the signed-in user (see POST /api/invites/[token]).
export default function InvitePage({ params }: { params: Promise<{ token: string }> }) {
    const { token } = use(params)
    const { user, loading: authLoading } = useAuth()
    const { data, error, loading } = useApi<{ invite: InviteInfo }>(`/api/invites/${token}`)
    const [accepting, setAccepting] = useState(false)
    const [accepted, setAccepted] = useState(false)
    const [acceptErr, setAcceptErr] = useState<string | null>(null)

    const invite = data?.invite

    async function accept() {
        setAccepting(true)
        setAcceptErr(null)
        try {
            const body = await apiMutate<{ team_id?: string }>(`/api/invites/${token}`, { method: "POST" })
            // Switch into the joined team, then land in the app.
            if (body?.team_id) document.cookie = `team_id=${encodeURIComponent(body.team_id)}; path=/; max-age=31536000; samesite=lax`
            setAccepted(true)
            window.location.assign("/projects")
        } catch (e) {
            if (e instanceof ApiError) setAcceptErr(e.message ?? "Couldn't accept the invitation")
            else setAcceptErr("Network error")
        } finally {
            setAccepting(false)
        }
    }

    return (
        <div className="grid min-h-screen place-items-center bg-[color:var(--c-shell)] px-4">
            <div className="w-full max-w-md rounded-[18px] border border-[color:var(--c-border)] bg-white p-7 shadow-[0_12px_40px_rgba(17,24,39,0.08)]">
                {loading || authLoading ? (
                    <div className="space-y-3">
                        <div className="skeleton h-6 w-40 rounded" />
                        <div className="skeleton h-4 w-64 rounded" />
                        <div className="skeleton h-10 w-full rounded-[10px]" />
                    </div>
                ) : error || !invite ? (
                    <div className="text-center">
                        <h1 className="text-[18px] font-bold">Invitation unavailable</h1>
                        <p className="mt-2 text-[13px] text-[color:var(--c-text-muted)]">{error ?? "This invite is invalid, expired, or already used."}</p>
                        <Link href="/projects" className="mt-5 inline-block rounded-[10px] bg-[color:var(--c-primary)] px-4 py-2 text-[13px] font-semibold text-white">Go to Ucelot</Link>
                    </div>
                ) : (
                    <div>
                        <h1 className="text-[19px] font-bold tracking-[-0.01em]">
                            Join <span className="text-[color:var(--c-primary)]">{invite.team_name}</span>
                        </h1>
                        <p className="mt-2 text-[13px] text-[color:var(--c-text-muted)]">
                            You’ve been invited to join <strong>{invite.team_name}</strong> as <strong>{invite.role}</strong> ({invite.email}).
                        </p>

                        {!user ? (
                            <div className="mt-5">
                                <p className="text-[12.5px] text-[color:var(--c-text-muted)]">Sign in with <strong>{invite.email}</strong> to accept.</p>
                                <Link
                                    href={`/login?next=${encodeURIComponent(`/invite/${token}`)}`}
                                    className="mt-3 inline-block w-full rounded-[10px] bg-[color:var(--c-primary)] px-4 py-2.5 text-center text-[13px] font-semibold text-white"
                                >
                                    Sign in to accept
                                </Link>
                            </div>
                        ) : (
                            <div className="mt-5">
                                {user.email?.toLowerCase() !== invite.email.toLowerCase() && (
                                    <p className="mb-2 rounded-[10px] bg-amber-50 px-3 py-2 text-[12px] text-amber-800">
                                        You’re signed in as {user.email}, but this invite is for {invite.email}. Sign in with the invited address to accept.
                                    </p>
                                )}
                                <button
                                    type="button"
                                    onClick={accept}
                                    disabled={accepting || accepted}
                                    className="w-full rounded-[10px] bg-[color:var(--c-primary)] px-4 py-2.5 text-[13px] font-semibold text-white disabled:opacity-50"
                                >
                                    {accepted ? "Joined!" : accepting ? "Joining…" : `Accept & join ${invite.team_name}`}
                                </button>
                                {acceptErr && <p className="mt-2 text-[12px] text-rose-600">{acceptErr}</p>}
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    )
}
