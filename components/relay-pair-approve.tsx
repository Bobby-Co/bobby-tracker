"use client"

import { useState } from "react"
import { Spinner } from "@/components/spinner"

// Normalise a raw device code into the displayed XXXX-XXXX form: strip
// everything that isn't an alnum, uppercase, then hyphenate after the
// first four chars. Cap at 8 significant chars so a paste of a longer
// string doesn't trail garbage.
function formatCode(raw: string): string {
    const clean = raw.replace(/[^a-zA-Z0-9]/g, "").toUpperCase().slice(0, 8)
    if (clean.length <= 4) return clean
    return `${clean.slice(0, 4)}-${clean.slice(4)}`
}

type Phase = "idle" | "approving" | "denying" | "done"

// The pairing approval form. Reused in two places: the /workers "Link a
// device" modal (no initialCode — user types it) and the /link page that
// the relay app opens with a prefilled code. When initialCode is present
// we also surface a "Deny" action so a mis-typed / unwanted prompt can be
// rejected straight from the page.
export function RelayPairApprove({
    initialCode,
    onDone,
}: {
    initialCode?: string
    onDone?: () => void
}) {
    const [code, setCode] = useState(() => formatCode(initialCode ?? ""))
    const [phase, setPhase] = useState<Phase>("idle")
    const [error, setError] = useState<string | null>(null)
    const [linkedName, setLinkedName] = useState<string | null>(null)

    const userCode = code.replace(/-/g, "")
    const busy = phase === "approving" || phase === "denying"
    const canSubmit = userCode.length >= 8 && !busy

    async function approve() {
        if (!canSubmit) return
        setPhase("approving")
        setError(null)
        try {
            const res = await fetch("/api/relay/pair/approve", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ userCode }),
            })
            const data = await res.json().catch(() => ({}))
            if (!res.ok) {
                if (res.status === 404) {
                    setError("Code invalid or expired. Check the Bobby Relay app for the current code.")
                } else {
                    setError(data?.error?.message || `Couldn't link (${res.status}).`)
                }
                setPhase("idle")
                return
            }
            setLinkedName(typeof data?.name === "string" ? data.name : null)
            setPhase("done")
            onDone?.()
        } catch {
            setError("Network error — try again.")
            setPhase("idle")
        }
    }

    async function deny() {
        if (busy) return
        setPhase("denying")
        setError(null)
        try {
            await fetch("/api/relay/pair/deny", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ userCode }),
            })
            onDone?.()
        } catch {
            // Deny is best-effort; the code expires on its own anyway.
        } finally {
            setPhase("idle")
        }
    }

    if (phase === "done") {
        return (
            <div className="flex flex-col items-center gap-3 py-4 text-center">
                <span
                    aria-hidden
                    className="grid h-11 w-11 place-items-center rounded-full"
                    style={{ background: "var(--c-success-bg)", color: "var(--c-success)" }}
                >
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                        <path d="M5 12l5 5L20 7" />
                    </svg>
                </span>
                <div>
                    <p className="text-[15px] font-bold">
                        {linkedName ? `${linkedName} linked` : "Device linked"}
                    </p>
                    <p className="mt-1 text-[12.5px] text-[color:var(--c-text-muted)]">
                        It will connect within a few seconds. You can manage it from Local models.
                    </p>
                </div>
            </div>
        )
    }

    return (
        <div className="flex flex-col gap-4">
            <ol className="flex flex-col gap-2.5">
                <Step n={1}>
                    Open the <span className="font-semibold">Bobby Relay</span> app on your Mac — it shows a pairing code.
                </Step>
                <Step n={2}>Enter that code below and approve.</Step>
            </ol>

            <form
                onSubmit={(e) => { e.preventDefault(); approve() }}
                className="flex flex-col gap-3"
            >
                <label className="flex flex-col gap-1">
                    <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-[color:var(--c-text-muted)]">
                        Pairing code
                    </span>
                    <input
                        value={code}
                        onChange={(e) => setCode(formatCode(e.target.value))}
                        disabled={busy}
                        placeholder="XXXX-XXXX"
                        autoFocus
                        autoComplete="off"
                        spellCheck={false}
                        aria-label="Pairing code"
                        className="input text-center font-mono text-[18px] font-semibold tracking-[0.18em]"
                    />
                </label>

                {error && (
                    <p role="alert" className="rounded-[10px] bg-rose-50 px-3 py-2 text-[12.5px] text-rose-800">
                        {error}
                    </p>
                )}

                <div className="flex flex-col gap-2 sm:flex-row-reverse">
                    <button type="submit" disabled={!canSubmit} className="btn-primary w-full sm:w-auto">
                        {phase === "approving" ? (<><Spinner />Linking…</>) : "Approve & link"}
                    </button>
                    {initialCode && (
                        <button
                            type="button"
                            onClick={deny}
                            disabled={busy}
                            className="btn-ghost w-full text-rose-700 hover:bg-rose-50 sm:w-auto"
                        >
                            {phase === "denying" ? (<><Spinner />Denying…</>) : "Deny"}
                        </button>
                    )}
                </div>
            </form>
        </div>
    )
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
    return (
        <li className="flex items-start gap-2.5 text-[13px] text-[color:var(--c-text-muted)]">
            <span
                aria-hidden
                className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-[color:var(--c-surface-2)] text-[11px] font-bold text-[color:var(--c-text)]"
            >
                {n}
            </span>
            <span className="leading-5">{children}</span>
        </li>
    )
}
