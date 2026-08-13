"use client"

// Newsletter sign-up for the landing footer.
//
// Its own client component so the landing page itself stays a server
// component — this is the only interactive thing below the fold.

import { useState } from "react"

type State = "idle" | "sending" | "done" | "error"

export default function NewsletterForm() {
    const [email, setEmail] = useState("")
    const [state, setState] = useState<State>("idle")
    const [message, setMessage] = useState("")

    async function onSubmit(e: React.FormEvent) {
        e.preventDefault()
        if (state === "sending") return
        setState("sending")
        setMessage("")
        try {
            const res = await fetch("/api/newsletter", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ email }),
            })
            const body = (await res.json().catch(() => ({}))) as { error?: string }
            if (!res.ok) {
                setState("error")
                setMessage(body.error ?? "Something went wrong. Try again shortly.")
                return
            }
            setState("done")
            setEmail("")
        } catch {
            setState("error")
            setMessage("Couldn't reach the server. Check your connection and try again.")
        }
    }

    if (state === "done") {
        return (
            <p className="mt-4 flex items-center gap-2 text-[13.5px] font-semibold text-[color:var(--c-accent)]">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M20 6 9 17l-5-5" />
                </svg>
                You&apos;re on the list. We&apos;ll be in touch.
            </p>
        )
    }

    return (
        <form onSubmit={onSubmit} className="mt-4">
            <label htmlFor="nl-email" className="sr-only">
                Email address
            </label>
            <div className="flex max-w-sm items-center gap-2 rounded-sq-l border border-[color:var(--c-secondary)]/12 bg-[color:var(--c-surface)] p-1.5 focus-within:border-[color:var(--c-secondary)]/25">
                <input
                    id="nl-email"
                    type="email"
                    required
                    value={email}
                    onChange={(e) => {
                        setEmail(e.target.value)
                        if (state === "error") setState("idle")
                    }}
                    placeholder="you@company.com"
                    autoComplete="email"
                    className="min-w-0 flex-1 bg-transparent px-2.5 py-1.5 text-[13.5px] text-[color:var(--c-secondary)] outline-none placeholder:text-[color:var(--c-secondary)]/35"
                />
                <button
                    type="submit"
                    disabled={state === "sending"}
                    className="shrink-0 rounded-sq bg-[var(--c-secondary)] px-3.5 py-2 text-[12.5px] font-bold text-[#fffae8] transition-opacity hover:opacity-90 disabled:opacity-50"
                >
                    {state === "sending" ? "Sending…" : "Subscribe"}
                </button>
            </div>
            {state === "error" && (
                <p role="alert" className="mt-2 text-[12.5px] font-semibold text-red-700">
                    {message}
                </p>
            )}
        </form>
    )
}
