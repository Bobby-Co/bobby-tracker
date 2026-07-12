import Link from "next/link"

// Rendered on /p/[token] (and the per-issue subroute) when the session
// is invite-only and the visitor isn't allowed in. Two flavours:
//
//   - "unauthenticated" — they need to sign in. CTA goes to /login
//     with ?next so they bounce straight back here after auth.
//
//   - "not_invited" — signed-in user, but their email isn't on the
//     whitelist. We surface the email so they can check whether they
//     signed in with the wrong account, plus a "use a different
//     account" path that signs them out and sends them back to login.
export function PublicSessionGate({
    reason,
    email,
    nextPath,
    heading,
}: {
    reason: "unauthenticated" | "not_invited"
    email: string | null
    /** Path the visitor is currently on — e.g. "/p/<token>". Used as
     *  ?next on the sign-in / sign-out hops so they land back here. */
    nextPath: string
    /** Session title to render above the gate, when known. */
    heading: string | null
}) {
    return (
        <main className="mx-auto flex min-h-screen w-full max-w-md flex-col items-center justify-center gap-5 px-4 py-12 sm:px-6">
            <div className="anim-fade flex w-full flex-col items-center gap-4 rounded-[16px] border border-[color:var(--c-border)] bg-white p-6 text-center shadow-[var(--shadow-card)] sm:p-8">
                <span className="grid h-12 w-12 place-items-center rounded-full bg-zinc-100 text-zinc-700">
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                        <rect x="3" y="11" width="18" height="10" rx="2" />
                        <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                    </svg>
                </span>

                {heading && (
                    <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-[color:var(--c-text-muted)]">
                        {heading}
                    </div>
                )}

                {reason === "unauthenticated" ? (
                    <>
                        <h1 className="text-[20px] font-bold leading-tight tracking-[-0.012em]">
                            Invite-only submission link
                        </h1>
                        <p className="text-[13px] leading-relaxed text-[color:var(--c-text-muted)]">
                            The owner restricted this link to invited people. Sign in to check whether you&apos;re on the list.
                        </p>
                        <Link
                            href={`/login?next=${encodeURIComponent(nextPath)}`}
                            className="btn-primary w-full"
                        >
                            Sign in to continue
                        </Link>
                    </>
                ) : (
                    <>
                        <h1 className="text-[20px] font-bold leading-tight tracking-[-0.012em]">
                            You&apos;re not on the invite list
                        </h1>
                        <p className="text-[13px] leading-relaxed text-[color:var(--c-text-muted)]">
                            {email ? (
                                <>You&apos;re signed in as <span className="font-mono font-semibold text-[color:var(--c-text)]">{email}</span>, but the owner hasn&apos;t invited that address.</>
                            ) : (
                                <>The owner hasn&apos;t invited the account you&apos;re signed in with.</>
                            )}
                        </p>
                        <p className="text-[12.5px] text-[color:var(--c-text-dim)]">
                            Reach out to the owner to be added — or sign in with a different account if you have an invitation under another email.
                        </p>
                        <form
                            action="/auth/sign-out"
                            method="post"
                            className="w-full"
                        >
                            <input type="hidden" name="next" value={`/login?next=${encodeURIComponent(nextPath)}`} />
                            <button type="submit" className="btn-ghost w-full">
                                Use a different account
                            </button>
                        </form>
                    </>
                )}
            </div>
        </main>
    )
}
