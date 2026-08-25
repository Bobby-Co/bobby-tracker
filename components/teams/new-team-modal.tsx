"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Modal } from "@/components/ui/modal"
import { ApiError, apiMutate } from "@/lib/client/http/api-client"
import { useApi } from "@/lib/client/hooks/use-api"
import { RegionMap, type RegionOption } from "@/components/teams/region-map"

// Creating a team is the one moment its region is chosen, so it gets a modal
// rather than the cramped dropdown form it used to live in. Placement is fixed
// for the life of the team — every project it owns is served from there — and
// that is not a decision to make in a 200px popover.
//
// The map is only shown when there is an actual choice. One region means one
// possible answer, and a map with a single pin asks the user to confirm
// something they cannot change.

export function NewTeamModal({
    open,
    onClose,
    onCreated,
}: {
    open: boolean
    onClose: () => void
    /** Fired with the new team's id so the caller can switch to it. */
    onCreated: (teamId: string) => void
}) {
    const [name, setName] = useState("")
    const [pickedRegion, setPickedRegion] = useState("")
    const [busy, setBusy] = useState(false)
    const [err, setErr] = useState<string | null>(null)
    // Set when the server says both free team slots are in use (402). This isn't
    // an error the user can fix in this form, so the modal stops asking for a name
    // and offers the two things that actually resolve it.
    const [planRequired, setPlanRequired] = useState(false)
    const router = useRouter()

    // Only fetch while open — this mounts alongside the top bar on every page.
    const regionsQ = useApi<{ regions: RegionOption[] }>(open ? "/api/regions" : null)
    const regions = regionsQ.data?.regions ?? []
    // Derived, not synced by an effect: until the user picks, the first region IS
    // the selection, so the map always shows what will be submitted.
    const region = pickedRegion || regions[0]?.id || ""

    function reset() {
        setName("")
        setPickedRegion("")
        setErr(null)
        setPlanRequired(false)
    }

    async function submit(e: React.FormEvent) {
        e.preventDefault()
        const trimmed = name.trim()
        if (!trimmed) return
        setBusy(true)
        setErr(null)
        try {
            const body = await apiMutate<{ team?: { id?: string } }>("/api/teams", {
                method: "POST",
                // Omitted when no region is known — the server then places the team
                // at home, which is the only available answer anyway.
                body: { name: trimmed, ...(region ? { region } : {}) },
            })
            if (body?.team?.id) onCreated(body.team.id)
            reset()
            onClose()
        } catch (e) {
            if (e instanceof ApiError && e.code === "plan_required") setPlanRequired(true)
            else if (e instanceof ApiError) setErr(e.message ?? "Couldn't create team")
            else setErr("Network error")
        } finally {
            setBusy(false)
        }
    }

    return (
        <Modal
            open={open}
            onClose={() => { reset(); onClose() }}
            title="Create a team"
            description="Teams own projects, members and billing."
            size={regions.length > 1 ? "lg" : "md"}
        >
            {planRequired ? (
                <div className="flex flex-col gap-3">
                    <p className="text-[13px] font-semibold text-[color:var(--c-text)]">
                        Both of your free teams are in use
                    </p>
                    <p className="text-[12.5px] leading-relaxed text-[color:var(--c-text-muted)]">
                        Every account gets two free teams — this one and one more. To run another, put it on a plan,
                        or pause a team you&rsquo;re not using: a paused team keeps everything and gives its slot
                        back.
                    </p>
                    <div className="flex justify-end gap-2 pt-1">
                        <button
                            type="button"
                            onClick={() => { reset(); onClose() }}
                            className="h-8 rounded-[8px] border border-[color:var(--c-border)] px-3 text-[12.5px]"
                        >
                            Not now
                        </button>
                        <button
                            type="button"
                            onClick={() => { reset(); onClose(); router.push("/settings/billing") }}
                            className="btn-primary"
                        >
                            Choose a plan
                        </button>
                    </div>
                </div>
            ) : (
            <form onSubmit={submit} className="flex flex-col gap-3">
                <label className="flex flex-col gap-1">
                    <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-[color:var(--c-text-muted)]">
                        Team name
                    </span>
                    <input
                        autoFocus
                        required
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="Acme Engineering"
                        disabled={busy}
                        className="input"
                    />
                </label>

                {regions.length > 1 && (
                    <div className="flex flex-col gap-1.5">
                        <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-[color:var(--c-text-muted)]">
                            Region
                        </span>
                        <RegionMap regions={regions} value={region} onChange={setPickedRegion} disabled={busy} />
                        <p className="text-[11.5px] leading-snug text-[color:var(--c-text-muted)]">
                            Where this team&rsquo;s code is stored and analysed. Every project it owns is served from
                            here, and it can&rsquo;t be changed later — moving a team means re-indexing every one of
                            its repositories.
                        </p>
                    </div>
                )}

                {err && <p className="text-[12.5px] text-rose-700">{err}</p>}

                <div className="flex justify-end gap-2 pt-1">
                    <button
                        type="button"
                        onClick={() => { reset(); onClose() }}
                        disabled={busy}
                        className="h-8 rounded-[8px] border border-[color:var(--c-border)] px-3 text-[12.5px]"
                    >
                        Cancel
                    </button>
                    <button type="submit" disabled={busy || !name.trim()} className="btn-primary">
                        {busy ? "Creating…" : "Create team"}
                    </button>
                </div>
            </form>
            )}
        </Modal>
    )
}
