"use client"

import Link from "next/link"
import { useEffect, useRef, useState } from "react"
import { AnimatePresence, motion } from "framer-motion"
import { cn } from "@/components/ui/cn"
import { useTeam } from "@/lib/auth/team-context"
import { ApiError, apiMutate } from "@/lib/api-client"

// Top-bar workspace switcher. Shows the active team and, on open, the full list
// (switch), a link to manage the current team, and an inline create-team form.
export function TeamSelector() {
    const { teams, activeTeam, loading, setActiveTeam, refetch } = useTeam()
    const [open, setOpen] = useState(false)
    const [creating, setCreating] = useState(false)
    const [name, setName] = useState("")
    const [busy, setBusy] = useState(false)
    const [err, setErr] = useState<string | null>(null)
    const ref = useRef<HTMLDivElement>(null)

    useEffect(() => {
        if (!open) return
        const onDoc = (e: MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
        }
        document.addEventListener("mousedown", onDoc)
        return () => document.removeEventListener("mousedown", onDoc)
    }, [open])

    async function createTeam(e: React.FormEvent) {
        e.preventDefault()
        const trimmed = name.trim()
        if (!trimmed) return
        setBusy(true)
        setErr(null)
        try {
            const body = await apiMutate<{ team?: { id?: string } }>("/api/teams", {
                method: "POST",
                body: { name: trimmed },
            })
            refetch()
            if (body?.team?.id) setActiveTeam(body.team.id) // switches + reloads
        } catch (e) {
            if (e instanceof ApiError) setErr(e.message ?? "Couldn't create team")
            else setErr("Network error")
        } finally {
            setBusy(false)
        }
    }

    if (loading && !activeTeam) {
        return <div className="skeleton h-7 w-full rounded-[10px]" aria-hidden />
    }
    if (!activeTeam) return null

    return (
        <div ref={ref} className="relative">
            <button
                type="button"
                onClick={() => setOpen((o) => !o)}
                aria-haspopup="menu"
                aria-expanded={open}
                className="flex w-full items-center gap-2 rounded-sq-l bg-[color:var(--c-surface)] pl-2.5 pr-4 py-[4.5px] text-[12.5px] font-semibold text-zinc-900 ring-1 ring-[color:var(--c-border)] shadow-[0_1px_1px_rgba(17,24,39,0.02)] hover:ring-[color:var(--c-border-strong)]"
            >
                <TeamAvatar name={activeTeam.name} personal={activeTeam.is_personal} size={18} />
                <span className="min-w-0 flex-1 truncate text-left">{activeTeam.name}</span>
                <Caret open={open} />
            </button>

            <AnimatePresence>
            {open && (
                <motion.div
                    role="menu"
                    initial={{ opacity: 0, y: -6, scale: 0.97 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -6, scale: 0.97 }}
                    transition={{ duration: 0.15, ease: [0.16, 1, 0.3, 1] }}
                    style={{ transformOrigin: "top" }}
                    className="absolute left-0 right-0 top-[calc(100%+6px)] z-40 overflow-hidden rounded-[12px] border border-[color:var(--c-border)] bg-[color:var(--c-surface)] p-1.5 shadow-[0_12px_32px_rgba(17,24,39,0.14)]"
                >
                    <div className="px-2 py-1 text-[10.5px] font-semibold uppercase tracking-wide text-[color:var(--c-text-muted)]">
                        Teams
                    </div>
                    <div className="max-h-64 overflow-y-auto">
                        {teams.map((t) => {
                            const active = t.id === activeTeam.id
                            return (
                                <button
                                    key={t.id}
                                    type="button"
                                    role="menuitemradio"
                                    aria-checked={active}
                                    onClick={() => (active ? setOpen(false) : setActiveTeam(t.id))}
                                    className={cn(
                                        "flex w-full items-center gap-2.5 rounded-[9px] px-2 py-1.5 text-left text-[11px] transition-colors",
                                        active ? "bg-[color:var(--c-surface-2)] font-semibold" : "hover:bg-[color:var(--c-overlay)]",
                                    )}
                                >
                                    <TeamAvatar name={t.name} personal={t.is_personal} size={20} />
                                    <span className="min-w-0 flex-1 truncate">{t.name}</span>
                                    <span className="shrink-0 text-[10.5px] capitalize text-[color:var(--c-text-muted)]">{t.role}</span>
                                    {active && <CheckIcon />}
                                </button>
                            )
                        })}
                    </div>

                    <div className="my-1.5 h-px bg-[color:var(--c-border)]" />

                    <Link
                        href="/team"
                        onClick={() => setOpen(false)}
                        role="menuitem"
                        className="flex items-center gap-2 rounded-[9px] px-2 py-1.5 text-[11px] text-[color:var(--c-text)] transition-colors hover:bg-[color:var(--c-overlay)]"
                    >
                        <GearIcon />
                        <span>Manage “{activeTeam.name}”</span>
                    </Link>

                    {creating ? (
                        <form onSubmit={createTeam} className="px-1 pb-1 pt-1">
                            <input
                                autoFocus
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                placeholder="Team name"
                                disabled={busy}
                                className="mb-1.5 h-8 w-full rounded-[8px] border border-[color:var(--c-border)] bg-[color:var(--c-surface)] px-2.5 text-[13px] outline-none focus:border-[color:var(--c-primary)] focus:ring-[3px] focus:ring-[color:var(--c-ring)]"
                            />
                            {err && <p className="mb-1 px-0.5 text-[11.5px] text-red-600">{err}</p>}
                            <div className="flex gap-1.5">
                                <button
                                    type="submit"
                                    disabled={busy || !name.trim()}
                                    className="h-7 flex-1 rounded-[8px] bg-[color:var(--c-primary)] text-[11.5px] font-semibold text-white disabled:opacity-50"
                                >
                                    {busy ? "Creating…" : "Create"}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => { setCreating(false); setName(""); setErr(null) }}
                                    className="h-7 rounded-[8px] border border-[color:var(--c-border)] px-2.5 text-[11.5px]"
                                >
                                    Cancel
                                </button>
                            </div>
                        </form>
                    ) : (
                        <button
                            type="button"
                            role="menuitem"
                            onClick={() => setCreating(true)}
                            className="flex w-full items-center gap-2 rounded-[9px] px-2 py-1.5 text-left text-[11px] text-[color:var(--c-text)] transition-colors hover:bg-[color:var(--c-overlay)]"
                        >
                            <PlusIcon />
                            <span>Create team</span>
                        </button>
                    )}
                </motion.div>
            )}
            </AnimatePresence>
        </div>
    )
}

function TeamAvatar({ name, personal, size = 24 }: { name: string; personal: boolean; size?: number }) {
    const initial = name.trim()[0]?.toUpperCase() ?? "T"
    return (
        <span
            className={cn(
                "grid shrink-0 place-items-center rounded-[6px] font-bold text-white",
                personal ? "bg-zinc-500" : "bg-[color:var(--c-primary)]",
            )}
            style={{ width: size, height: size, fontSize: size <= 20 ? 10 : 11 }}
            aria-hidden
        >
            {initial}
        </span>
    )
}

function Caret({ open }: { open: boolean }) {
    return (
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden className={cn("shrink-0 text-[color:var(--c-text-dim)] transition-transform", open ? "rotate-180" : "")}>
            <path d="M6 9l6 6 6-6" />
        </svg>
    )
}
function CheckIcon() {
    return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="shrink-0 text-[color:var(--c-primary)]">
            <path d="M5 12l5 5L20 7" />
        </svg>
    )
}
function GearIcon() {
    return (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="text-[color:var(--c-text-dim)]">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
    )
}
function PlusIcon() {
    return (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="text-[color:var(--c-text-dim)]">
            <path d="M12 5v14M5 12h14" />
        </svg>
    )
}
