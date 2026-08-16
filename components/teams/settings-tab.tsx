"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { FieldRow, FieldTable, MiniCard } from "@/components/ui/field-card"
import { Modal } from "@/components/ui/modal"
import { ApiError, apiMutate } from "@/lib/client/http/api-client"
import { useTeam } from "@/lib/client/auth/team-context"
import type { TeamWithRole } from "@/lib/shared/types"

/** `south-east-asia` → `South East Asia`. Mirrors deriveRegionLabel on the server
 *  rather than importing it: modules/* is server-side, and this is one line. */
function labelFor(region: string): string {
    return region
        .split("-")
        .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
        .join(" ")
}

export function SettingsTab({ team }: { team: TeamWithRole }) {
    const isOwner = team.role === "owner"

    return (
        <div className="flex max-w-2xl flex-col gap-6">
            <PlacementCard team={team} />
            {isOwner && <DangerZone team={team} />}
        </div>
    )
}

// Read-only by design. Placement is fixed when the team is created because every
// project it owns is served from there — changing it means re-indexing all of
// them, which is a migration rather than a setting. Showing it anyway, because
// "where is my code being analysed?" is a question people have and currently have
// no way to answer.
function PlacementCard({ team }: { team: TeamWithRole }) {
    return (
        <MiniCard
            tone="cyan"
            interactive={false}
            icon={
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
                    <circle cx="12" cy="12" r="9" />
                    <path d="M3 12h18M12 3a15 15 0 0 1 0 18a15 15 0 0 1 0-18" />
                </svg>
            }
            title="Data location"
            subtitle="Where this team's code is stored and analysed"
        >
            <FieldTable>
                <FieldRow label="Region">
                    {team.region ? labelFor(team.region) : <span className="text-[color:var(--c-text-muted)]">Unknown</span>}
                </FieldRow>
            </FieldTable>
            <p className="mt-2 text-[12px] text-[color:var(--c-text-muted)]">
                Chosen when the team was created and shared by every project it owns. Changing it means re-indexing
                those repositories elsewhere — contact support if you need this team moved.
            </p>
        </MiniCard>
    )
}

function DangerZone({ team }: { team: TeamWithRole }) {
    const router = useRouter()
    const { refetch } = useTeam()
    const [confirming, setConfirming] = useState(false)
    const [confirm, setConfirm] = useState("")
    const [busy, setBusy] = useState(false)
    const [err, setErr] = useState<string | null>(null)

    // A personal team is bootstrapped on first sight of a user, so deleting it
    // just recreates it on the next page load — which reads as the button being
    // broken. Refuse up front rather than explain that afterwards.
    if (team.is_personal) {
        return (
            <section className="rounded-[12px] border border-[color:var(--c-border)] p-4">
                <h3 className="text-[13px] font-bold">Delete team</h3>
                <p className="mt-1 text-[12.5px] text-[color:var(--c-text-muted)]">
                    Your personal team can&rsquo;t be deleted — it&rsquo;s created automatically and would come back on
                    your next visit.
                </p>
            </section>
        )
    }

    const armed = confirm.trim() === team.name && !busy

    function close() {
        if (busy) return
        setConfirming(false)
        setConfirm("")
        setErr(null)
    }

    async function destroy() {
        if (!armed) return
        setBusy(true)
        setErr(null)
        try {
            await apiMutate(`/api/teams/${team.id}`, { method: "DELETE" })
            refetch()
            router.push("/projects")
            router.refresh()
        } catch (e) {
            setErr(e instanceof ApiError ? (e.message ?? "Couldn't delete team") : "Network error")
            setBusy(false)
        }
    }

    return (
        <section className="rounded-[12px] border border-rose-300 bg-rose-50/40 p-4 dark:border-rose-900/60 dark:bg-rose-950/20">
            <h3 className="text-[13px] font-bold text-rose-700 dark:text-rose-400">Delete this team</h3>
            <p className="mt-1 text-[12.5px] text-[color:var(--c-text-muted)]">
                Permanently removes the team, its members and access groups, and every project it owns.
            </p>
            <button
                type="button"
                onClick={() => setConfirming(true)}
                className="mt-3 h-8 rounded-[8px] border border-rose-400 px-3 text-[12.5px] font-semibold text-rose-700 transition-colors hover:bg-rose-600 hover:text-white dark:border-rose-800 dark:text-rose-400"
            >
                Delete team
            </button>

            {/* The confirmation lives in its own modal rather than inline: a
                type-to-confirm field sitting permanently in the page invites
                someone to fill it in while reading, and the consequences deserve
                a deliberate step that takes over the screen. */}
            <Modal
                open={confirming}
                onClose={close}
                title={`Delete ${team.name}?`}
                description="This cannot be undone."
                size="sm"
            >
                <div className="flex flex-col gap-3">
                    <p className="text-[12.5px] leading-relaxed text-[color:var(--c-text-muted)]">
                        Deletes every project this team owns — with their issues, pull requests, comments and
                        knowledge graphs — along with its members and access groups.
                    </p>

                    <label className="flex flex-col gap-1">
                        <span className="text-[11.5px] text-[color:var(--c-text-muted)]">
                            Type <strong className="text-[color:var(--c-text)]">{team.name}</strong> to confirm
                        </span>
                        <input
                            autoFocus
                            value={confirm}
                            onChange={(e) => setConfirm(e.target.value)}
                            disabled={busy}
                            placeholder={team.name}
                            autoComplete="off"
                            className="input"
                        />
                    </label>

                    {err && <p className="text-[12.5px] text-rose-700">{err}</p>}

                    <div className="flex justify-end gap-2 pt-1">
                        <button
                            type="button"
                            onClick={close}
                            disabled={busy}
                            className="h-8 rounded-[8px] border border-[color:var(--c-border)] px-3 text-[12.5px]"
                        >
                            Cancel
                        </button>
                        <button
                            type="button"
                            onClick={destroy}
                            disabled={!armed}
                            className="h-8 rounded-[8px] bg-rose-600 px-3 text-[12.5px] font-semibold text-white transition-opacity disabled:opacity-40"
                        >
                            {busy ? "Deleting…" : "Delete team"}
                        </button>
                    </div>
                </div>
            </Modal>
        </section>
    )
}
