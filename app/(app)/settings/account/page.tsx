"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useAuth } from "@/lib/client/auth/auth-context"
import { useApi } from "@/lib/client/hooks/use-api"
import { Modal } from "@/components/ui/modal"
import { DELETE_ACCOUNT_FLAG } from "@/lib/client/account-deletion"

// Settings → Account. Today this is the danger zone and nothing else: the profile
// fields still live in the identity provider's OAuth data.
//
// The page itself stays QUIET — a heading, a sentence, a button. Everything that
// deleting an account would do is consequence, and consequences belong in the
// step where the user has chosen to look at them, not spread across a settings
// page they wandered into. Pressing the button opens the modal, and the modal is
// where the plan is fetched, read and confirmed.
//
// Every colour here is a theme token (--c-rose-*, --c-error*, --c-warn*), so the
// danger styling holds on the dark theme. Literal palette classes like `rose-50`
// are single-register by definition — they were what made this section glow on a
// dark desk.

interface TeamSummary {
    id: string
    name: string
    isPersonal: boolean
}

interface DeletionPreflight {
    blocked: TeamSummary[]
    willDelete: TeamSummary[]
    willLeave: TeamSummary[]
    canProceed: boolean
}

export default function AccountSettingsPage() {
    const { user } = useAuth()
    const [confirming, setConfirming] = useState(false)
    const email = user?.email ?? ""

    return (
        <div className="max-w-[640px] space-y-8">
            <section>
                <h2 className="text-[13px] font-bold">Account</h2>
                <p className="mt-1 text-[12.5px] text-[color:var(--c-text-muted)]">
                    Signed in as <span className="font-semibold text-[color:var(--c-text)]">{email || "…"}</span>
                </p>
            </section>

            <section className="rounded-[12px] border border-[color:var(--c-rose-fg)]/30 bg-[color:var(--c-rose-bg)]/40 p-4">
                <h3 className="text-[13px] font-bold text-[color:var(--c-rose-fg)]">Delete account</h3>
                <p className="mt-1 text-[12.5px] text-[color:var(--c-text-muted)]">
                    Permanently removes your account, the teams only you belong to, and everything in them.
                </p>
                <button
                    type="button"
                    onClick={() => setConfirming(true)}
                    className="mt-3 h-8 rounded-[8px] border border-[color:var(--c-rose-fg)]/40 px-3 text-[12.5px] font-semibold text-[color:var(--c-rose-fg)] transition-colors hover:bg-rose-600 hover:text-white"
                >
                    Delete account
                </button>
            </section>

            <DeleteAccountModal open={confirming} onClose={() => setConfirming(false)} email={email} />
        </div>
    )
}

/** The whole deletion flow: what it will do, what has to happen first, and the
 *  confirmation. Fetches only while open — this modal's data is a list of the
 *  user's teams and their owner counts, which is wasted work on every visit to a
 *  settings page nobody came here to use. */
function DeleteAccountModal({ open, onClose, email }: { open: boolean; onClose: () => void; email: string }) {
    const preflightQ = useApi<DeletionPreflight>(open ? "/api/account" : null)
    const plan = preflightQ.data

    const [confirm, setConfirm] = useState("")
    const [leaving, setLeaving] = useState(false)
    const router = useRouter()

    // Type the account's own email. Deliberately not an "I'm sure" checkbox: the
    // string you have to reproduce is the thing being destroyed.
    const ready = confirm.trim().toLowerCase() === email.toLowerCase() && !leaving && !!plan?.canProceed

    function close() {
        if (leaving) return
        setConfirm("")
        onClose()
    }

    // This dialog decides; /goodbye does. The request walks every team, purges
    // each project's regional content and finally removes the login — too long to
    // hold a modal open over a page the user is about to lose access to, and one
    // stray navigation away from an aborted request. So we arm the marker and
    // hand off; the failure states live over there too, next to the thing that
    // can fail.
    function handOff() {
        if (!ready) return
        setLeaving(true)
        sessionStorage.setItem(DELETE_ACCOUNT_FLAG, "1")
        router.push("/goodbye")
    }

    const blocked = plan?.blocked ?? []

    return (
        <Modal
            open={open}
            onClose={close}
            title="Delete your account?"
            description={blocked.length > 0 ? "There's something to sort out first." : "This is permanent and takes effect immediately."}
            size="md"
        >
            <div className="flex flex-col gap-3">
                {preflightQ.loading && <div className="skeleton h-28 w-full rounded-[10px]" />}

                {preflightQ.error && (
                    <p className="rounded-[8px] bg-[color:var(--c-error-bg)] px-3 py-2 text-[12.5px] text-[color:var(--c-error)]">
                        Couldn&rsquo;t work out what deleting your account would affect, so the button stays off.
                    </p>
                )}

                {/* THE BLOCKER. First thing in the modal when it applies, and it
                    replaces the confirmation entirely rather than sitting above
                    it — there is nothing to confirm until this is resolved. */}
                {blocked.length > 0 && (
                    <div className="rounded-[10px] border border-[color:var(--c-warn)]/40 bg-[color:var(--c-warn-bg)] p-3">
                        <p className="text-[12.5px] font-bold text-[color:var(--c-warn)]">
                            You&rsquo;re the only owner of {blocked.length === 1 ? "a team that has" : "teams that have"} other
                            members
                        </p>
                        <ul className="mt-2 space-y-1">
                            {blocked.map((t) => (
                                <li key={t.id} className="text-[12.5px] font-semibold text-[color:var(--c-text)]">
                                    {t.name}
                                </li>
                            ))}
                        </ul>
                        <p className="mt-2 text-[12px] leading-relaxed text-[color:var(--c-text-muted)]">
                            Deleting your account would take {blocked.length === 1 ? "it" : "them"} away from everyone
                            else. Hand {blocked.length === 1 ? "it" : "each"} over with <strong>Make owner</strong> on
                            the members list, or delete the team yourself — then come back here.
                        </p>
                        <Link
                            href="/team?tab=members"
                            className="mt-2 inline-flex h-8 items-center rounded-[8px] border border-[color:var(--c-border)] bg-[color:var(--c-surface)] px-3 text-[12.5px] font-semibold text-[color:var(--c-text)] transition-colors hover:border-[color:var(--c-border-strong)]"
                        >
                            Go to team members
                        </Link>
                    </div>
                )}

                {/* THE ACKNOWLEDGEMENT. Named teams, not a generic warning: "Acme
                    and its 3 projects are deleted" is a fact someone can check,
                    where "all your data will be removed" is a phrase people scroll
                    past. */}
                {plan?.canProceed && (
                    <>
                        <ul className="flex flex-col gap-2">
                            {plan.willDelete.length > 0 && (
                                <Consequence
                                    tone="danger"
                                    title={`${plan.willDelete.length === 1 ? "This team is" : "These teams are"} deleted`}
                                    detail="Their projects, issues, pull requests and indexed code go with them."
                                    teams={plan.willDelete}
                                />
                            )}
                            {plan.willLeave.length > 0 && (
                                <Consequence
                                    tone="neutral"
                                    title={`You'll leave ${plan.willLeave.length === 1 ? "this team" : "these teams"}`}
                                    detail="Someone else owns them, so they carry on without you."
                                    teams={plan.willLeave}
                                />
                            )}
                            <Consequence
                                tone="danger"
                                title="Your sign-in is removed"
                                detail="Immediately, with no grace period. Nothing here can be restored afterwards — signing up again starts from empty."
                            />
                            <Consequence
                                tone="neutral"
                                title="This month's credit usage is remembered for 30 days"
                                detail="Against a one-way hash of your email, never the address itself, so free monthly credits can't be reset by deleting and signing up again. It expires on its own."
                            />
                        </ul>

                        <label className="mt-1 flex flex-col gap-1">
                            <span className="text-[11.5px] text-[color:var(--c-text-muted)]">
                                Type <strong className="text-[color:var(--c-text)]">{email}</strong> to confirm
                            </span>
                            <input
                                autoFocus
                                value={confirm}
                                onChange={(e) => setConfirm(e.target.value)}
                                disabled={leaving}
                                placeholder={email}
                                autoComplete="off"
                                className="input"
                            />
                        </label>
                    </>
                )}

                <div className="flex justify-end gap-2 pt-1">
                    <button
                        type="button"
                        onClick={close}
                        disabled={leaving}
                        className="h-8 rounded-[8px] border border-[color:var(--c-border)] px-3 text-[12.5px]"
                    >
                        {plan?.canProceed ? "Cancel" : "Close"}
                    </button>
                    {plan?.canProceed && (
                        <button
                            type="button"
                            onClick={handOff}
                            disabled={!ready}
                            className="h-8 rounded-[8px] bg-rose-600 px-3 text-[12.5px] font-semibold text-white transition-opacity disabled:opacity-40"
                        >
                            {leaving ? "Deleting…" : "Delete permanently"}
                        </button>
                    )}
                </div>
            </div>
        </Modal>
    )
}

/** One thing that will happen, with the teams it happens to. `danger` marks the
 *  irreversible ones so the eye can sort them from the merely informative at a
 *  glance — the list is read in about two seconds, and that ordering is most of
 *  what it communicates. */
function Consequence({
    tone,
    title,
    detail,
    teams = [],
}: {
    tone: "danger" | "neutral"
    title: string
    detail: string
    teams?: TeamSummary[]
}) {
    const danger = tone === "danger"
    return (
        <li className="flex gap-2.5 rounded-[10px] border border-[color:var(--c-border)] bg-[color:var(--c-surface-2)] p-3">
            <span
                aria-hidden
                className={`mt-[3px] h-2 w-2 shrink-0 rounded-full ${
                    danger ? "bg-[color:var(--c-error)]" : "bg-[color:var(--c-text-dim)]"
                }`}
            />
            <div className="min-w-0">
                <p
                    className={`text-[12.5px] font-bold ${
                        danger ? "text-[color:var(--c-error)]" : "text-[color:var(--c-text)]"
                    }`}
                >
                    {title}
                </p>
                {teams.length > 0 && (
                    <p className="mt-0.5 truncate text-[12.5px] font-semibold text-[color:var(--c-text)]">
                        {teams.map((t) => t.name + (t.isPersonal ? " (personal)" : "")).join(", ")}
                    </p>
                )}
                <p className="mt-0.5 text-[12px] leading-relaxed text-[color:var(--c-text-muted)]">{detail}</p>
            </div>
        </li>
    )
}
