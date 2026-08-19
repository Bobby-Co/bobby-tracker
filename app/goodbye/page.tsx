"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { ApiError, apiMutate } from "@/lib/client/http/api-client"
import { createClient } from "@/lib/client/supabase"
import { AuthShell } from "@/components/layout/auth-shell"
import { DELETE_ACCOUNT_FLAG } from "@/lib/client/account-deletion"

// /goodbye — where an account deletion actually happens, and the last thing the
// person sees.
//
// The work runs HERE rather than in the modal that asked for it, for one reason:
// deleting an account walks every team, purges each project's regional content
// and then removes the login, which takes as long as it takes. Watching that from
// a modal means staring at a spinner over a settings page you are about to lose
// access to, and any stray navigation kills the request. A page of its own can
// hold the progress honestly and end on something better than a redirect.
//
// ─── Why a flag, and not just "visit this page" ──────────────────────────────
//
// This page DELETES THE ACCOUNT. A URL that does that on sight is one shared link
// or one prefetch away from a catastrophe, so it will only act when the
// confirmation dialog set the marker below — set immediately before navigating,
// read once, and cleared before the request goes out. Anyone arriving without it
// (a bookmark, a curious visitor, a reload afterwards) gets a plain page and no
// request at all.
//
// Not in the (app) group on purpose: the shell's guard bounces users without a
// session, and by the end of this page that is exactly what the visitor is.

type Phase = "idle" | "working" | "done" | "failed"

export default function GoodbyePage() {
    const [phase, setPhase] = useState<Phase>("idle")
    const [err, setErr] = useState<string | null>(null)
    // React 18 mounts effects twice in dev StrictMode; the flag is consumed on
    // the first pass, but this makes the guarantee local rather than relying on
    // storage timing.
    const started = useRef(false)

    useEffect(() => {
        if (started.current) return
        const armed = sessionStorage.getItem(DELETE_ACCOUNT_FLAG)
        // Consume before doing anything, so a reload mid-flight cannot start a
        // second deletion.
        sessionStorage.removeItem(DELETE_ACCOUNT_FLAG)
        if (!armed) return
        started.current = true

        // The phase moves inside the async run rather than sitting in the effect
        // body: an effect that setStates synchronously is a cascading render, and
        // this one has real work to introduce anyway.
        void (async () => {
            setPhase("working")
            try {
                await apiMutate("/api/account", { method: "DELETE" })
            } catch (e) {
                setErr(
                    e instanceof ApiError
                        ? e.message
                        : "We couldn't reach the server. Nothing was deleted — please try again.",
                )
                setPhase("failed")
                return
            }
            // The session outlives the account by a moment. Clear it so the app
            // stops making requests as somebody who no longer exists.
            await createClient().auth.signOut().catch(() => {})
            setPhase("done")
        })()
    }, [])

    return (
        <AuthShell
            headline="Thanks for trying Ucelot."
            subtext="Your work stays yours — and the door stays open."
            contentClassName="max-w-[400px]"
        >
            {phase === "working" && <Working />}
            {phase === "done" && <Done />}
            {phase === "failed" && <Failed message={err} />}
            {phase === "idle" && <Idle />}
        </AuthShell>
    )
}

function Working() {
    return (
        <div className="anim-fade">
            <div className="flex items-center gap-3">
                <span className="gb-spinner" />
                <h1 className="text-[20px] font-extrabold tracking-[-0.02em]">Deleting your account…</h1>
            </div>
            <p className="mt-3 text-[13.5px] leading-6 text-[color:var(--c-text-muted)]">
                Removing your teams and everything they hold. This can take a moment if you had a lot indexed —
                please keep this tab open until it finishes.
            </p>
            <style>{SPINNER_CSS}</style>
        </div>
    )
}

function Done() {
    return (
        <div className="anim-fade">
            <div className="grid h-11 w-11 place-items-center rounded-full bg-[color:var(--c-success-bg)]">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
                    <path
                        d="M5 13l4 4L19 7"
                        stroke="var(--c-success)"
                        strokeWidth="2.6"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                    />
                </svg>
            </div>
            <h1 className="mt-5 text-[24px] font-extrabold tracking-[-0.02em]">
                Your account was successfully deleted.
            </h1>
            <p className="mt-3 text-[13.5px] leading-6 text-[color:var(--c-text-muted)]">
                Your projects, issues and indexed code are gone. Thank you for the time you spent with us; it
                genuinely helped shape what Ucelot is.
            </p>
            <p className="mt-3 text-[13.5px] leading-6 text-[color:var(--c-text-muted)]">
                And if you ever fancy another look, <strong className="text-[color:var(--c-text)]">we always
                welcome you back</strong> — sign up with the same email any time and start fresh.
            </p>
            {/* Said plainly, because the paragraph above it says "everything's
                gone" and there is exactly one exception. A product that quietly
                keeps something after "delete my account" has to name it. */}
            <p className="mt-4 rounded-[10px] bg-[color:var(--c-surface-2)] px-3 py-2.5 text-[12px] leading-relaxed text-[color:var(--c-text-muted)]">
                One exception, so you know: we keep this month&rsquo;s credit usage against a one-way hash of your
                email for 30 days — never the address itself — so free monthly credits can&rsquo;t be reset by
                deleting and signing up again. It expires on its own.
            </p>
            <div className="mt-7 flex flex-wrap gap-2.5">
                <Link href="/" className="btn-primary px-5 py-3 text-[14px]">
                    Back to home
                </Link>
                <Link href="/login" className="btn-ghost px-5 py-3 text-[14px]">
                    Sign up again
                </Link>
            </div>
        </div>
    )
}

function Failed({ message }: { message: string | null }) {
    return (
        <div className="anim-fade">
            <h1 className="text-[22px] font-extrabold tracking-[-0.02em]">That didn&rsquo;t go through</h1>
            <p className="mt-3 text-[13.5px] leading-6 text-[color:var(--c-text-muted)]">
                {message ?? "Something went wrong."}
            </p>
            <p className="mt-3 text-[13.5px] leading-6 text-[color:var(--c-text-muted)]">
                Your account is still here. Nothing is half-deleted — the request stops at the first problem and
                leaves everything else alone.
            </p>
            <div className="mt-7 flex flex-wrap gap-2.5">
                <Link href="/settings/account" className="btn-primary px-5 py-3 text-[14px]">
                    Back to settings
                </Link>
                <Link href="/projects" className="btn-ghost px-5 py-3 text-[14px]">
                    Go to projects
                </Link>
            </div>
        </div>
    )
}

/** Reached without the marker — a bookmark, a shared link, or a reload after the
 *  fact. Says nothing about whether an account was ever deleted, and deletes
 *  nothing. */
function Idle() {
    return (
        <div className="anim-fade">
            <h1 className="text-[22px] font-extrabold tracking-[-0.02em]">Nothing to do here</h1>
            <p className="mt-3 text-[13.5px] leading-6 text-[color:var(--c-text-muted)]">
                This page appears at the end of deleting an account. If you were looking for your projects, they&rsquo;re
                where you left them.
            </p>
            <div className="mt-7">
                <Link href="/" className="btn-primary px-5 py-3 text-[14px]">
                    Back to home
                </Link>
            </div>
        </div>
    )
}

const SPINNER_CSS = `
.gb-spinner {
    width: 20px; height: 20px; border-radius: 9999px;
    border: 2.5px solid color-mix(in srgb, var(--c-primary) 30%, transparent);
    border-top-color: var(--c-primary);
    animation: gb-spin 0.7s linear infinite;
}
@keyframes gb-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .gb-spinner { animation-duration: 2s; } }
`
