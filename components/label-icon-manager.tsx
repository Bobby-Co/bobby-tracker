"use client"

import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { cn } from "@/components/cn"
import { IconlyIcon } from "@/components/iconly-icon"
import { IconPicker } from "@/components/icon-picker"
import { Modal } from "@/components/modal"
import { defaultLabelColor } from "@/lib/timeline/labels"
import type { ProjectLabelIcon } from "@/lib/supabase/types"

// LabelIconManager — modal for managing the project's label
// configurations. Each label gets an icon (required) and a colour
// (optional, falls back to a hashed default from the palette).
//
// Two flows:
//   1. Existing labels in use on issues that don't yet have a
//      config get a "Pick icon" button.
//   2. The "Add new label" form at the top lets the user create a
//      brand-new label config — name + icon, then editable colour
//      — before any issue uses the label. Useful for prepping a
//      project's label set up front.
export function LabelIconManager({
    open,
    onClose,
    projectId,
    usedLabels,
    initialIcons,
}: {
    open: boolean
    onClose: () => void
    projectId: string
    usedLabels: string[]
    initialIcons: ProjectLabelIcon[]
}) {
    const router = useRouter()
    const [icons, setIcons] = useState<ProjectLabelIcon[]>(initialIcons)
    const [picker, setPicker] = useState<{ label: string; current: string | null; isNew?: boolean } | null>(null)
    const [busy, setBusy] = useState<string | null>(null)
    const [seenInitial, setSeenInitial] = useState(initialIcons)
    const [draftLabel, setDraftLabel] = useState("")
    const [draftError, setDraftError] = useState<string | null>(null)
    if (initialIcons !== seenInitial) {
        setSeenInitial(initialIcons)
        setIcons(initialIcons)
    }

    const byLabel = useMemo(() => {
        const m = new Map<string, ProjectLabelIcon>()
        for (const i of icons) m.set(i.label, i)
        return m
    }, [icons])

    // Union of (labels in use on issues) ∪ (labels that already
    // have a config). The second set lets us surface configs the
    // user created up front before any issue uses them.
    const allLabels = useMemo(() => {
        const set = new Set<string>(usedLabels)
        for (const i of icons) set.add(i.label)
        return Array.from(set).sort()
    }, [usedLabels, icons])

    const missing = usedLabels.filter((l) => !byLabel.has(l)).length

    async function persist(label: string, body: { icon_name?: string; color?: string | null }) {
        const cur = byLabel.get(label)
        const payload: Record<string, unknown> = { label }
        // PUT requires icon_name on insert. If we're updating an
        // existing row we still send the current icon so the
        // server's validation passes.
        payload.icon_name = body.icon_name ?? cur?.icon_name ?? "tag"
        if ("color" in body) payload.color = body.color
        else if (cur?.color != null) payload.color = cur.color
        const res = await fetch(`/api/projects/${projectId}/label-icons`, {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(payload),
        })
        if (!res.ok) throw new Error("save failed")
        const { icon } = (await res.json()) as { icon: ProjectLabelIcon }
        setIcons((prev) => {
            const next = prev.filter((p) => p.label !== icon.label)
            next.push(icon)
            return next
        })
        return icon
    }

    async function pick(iconName: string) {
        if (!picker) return
        const label = picker.label
        const isNew = picker.isNew && !byLabel.has(label)
        setBusy(label)
        try {
            await persist(label, {
                icon_name: iconName,
                // For brand-new labels, seed a default colour so
                // the chip renders something nice immediately.
                ...(isNew ? { color: defaultLabelColor(label) } : {}),
            })
            setPicker(null)
            if (picker.isNew) setDraftLabel("")
            router.refresh()
        } finally {
            setBusy(null)
        }
    }

    async function setColor(label: string, color: string) {
        if (!/^#[0-9a-fA-F]{6}$/.test(color)) return
        setBusy(label)
        try {
            await persist(label, { color })
            router.refresh()
        } finally {
            setBusy(null)
        }
    }

    function startCreate() {
        const trimmed = draftLabel.trim()
        if (!trimmed) {
            setDraftError("Type a label name first.")
            return
        }
        if (byLabel.has(trimmed)) {
            setDraftError("That label already exists.")
            return
        }
        setDraftError(null)
        setPicker({ label: trimmed, current: null, isNew: true })
    }

    return (
        <>
            <Modal
                open={open && !picker}
                onClose={onClose}
                title="Manage label icons & colours"
                description="Each label gets an icon and a colour used on the timeline and in issue chips."
                size="lg"
            >
                <div className="flex flex-col gap-4">
                    {/* Add-new section */}
                    <div className="rounded-[12px] border border-[color:var(--c-border)] bg-[color:var(--c-surface-2)] p-3">
                        <div className="mb-1.5 text-[10.5px] font-bold uppercase tracking-[0.12em] text-[color:var(--c-text-muted)]">
                            Add a new label
                        </div>
                        <div className="flex items-center gap-2">
                            <input
                                value={draftLabel}
                                onChange={(e) => { setDraftLabel(e.target.value); setDraftError(null) }}
                                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); startCreate() } }}
                                placeholder="e.g. design, perf, billing"
                                className="flex-1 rounded-[10px] border border-[color:var(--c-border)] bg-white px-3 py-2 text-[13px] outline-none focus:border-zinc-400"
                            />
                            <button
                                type="button"
                                onClick={startCreate}
                                className="rounded-[10px] bg-zinc-900 px-3 py-2 text-[12px] font-semibold text-white hover:bg-zinc-800"
                            >
                                Pick icon →
                            </button>
                        </div>
                        {draftError && (
                            <p className="mt-1.5 text-[11.5px] text-rose-600">{draftError}</p>
                        )}
                    </div>

                    {/* Existing labels */}
                    {allLabels.length === 0 ? (
                        <p className="rounded-[10px] border border-dashed border-[color:var(--c-border)] px-4 py-6 text-center text-[12.5px] text-[color:var(--c-text-muted)]">
                            No labels yet. Add one above, or label some issues and they&rsquo;ll show up here.
                        </p>
                    ) : (
                        <ul className="flex flex-col gap-2">
                            {allLabels.map((label) => {
                                const cur = byLabel.get(label) ?? null
                                const color = cur?.color ?? defaultLabelColor(label)
                                return (
                                    <li
                                        key={label}
                                        className="flex items-center gap-3 rounded-[12px] border border-[color:var(--c-border)] bg-white px-3 py-2.5"
                                    >
                                        {/* Color swatch — wraps a hidden
                                            <input type="color"> so a click
                                            opens the native picker. */}
                                        <label
                                            className="relative grid h-9 w-9 shrink-0 cursor-pointer place-items-center rounded-[10px] border border-[color:var(--c-border)] shadow-sm"
                                            style={{ background: color }}
                                            title="Change label colour"
                                        >
                                            <input
                                                type="color"
                                                value={color}
                                                onChange={(e) => setColor(label, e.target.value)}
                                                disabled={!cur || busy === label}
                                                className="absolute inset-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
                                                aria-label={`Colour for ${label}`}
                                            />
                                        </label>
                                        {/* Icon button — clicking opens the
                                            icon picker. */}
                                        <button
                                            type="button"
                                            onClick={() => setPicker({ label, current: cur?.icon_name ?? null })}
                                            disabled={busy === label}
                                            className={cn(
                                                "grid h-9 w-9 shrink-0 place-items-center rounded-[10px] disabled:opacity-50",
                                                cur ? "bg-zinc-900 text-white" : "bg-zinc-100 text-zinc-400 hover:bg-zinc-200",
                                            )}
                                            title="Change icon"
                                        >
                                            <IconlyIcon name={cur?.icon_name} size={18} />
                                        </button>
                                        <div className="min-w-0 flex-1">
                                            <p className="truncate text-[13px] font-semibold">{label}</p>
                                            <p className="truncate text-[11.5px] text-[color:var(--c-text-muted)]">
                                                {cur ? cur.icon_name : "No icon assigned"}
                                            </p>
                                        </div>
                                        {!cur && (
                                            <button
                                                type="button"
                                                onClick={() => setPicker({ label, current: null })}
                                                disabled={busy === label}
                                                className="rounded-[10px] border border-[color:var(--c-border)] bg-white px-3 py-1.5 text-[12px] font-semibold hover:bg-[color:var(--c-overlay)] disabled:opacity-50"
                                            >
                                                Pick icon
                                            </button>
                                        )}
                                    </li>
                                )
                            })}
                        </ul>
                    )}
                    <p className="mt-1 text-[11.5px] text-[color:var(--c-text-muted)]">
                        {missing === 0
                            ? "All labels mapped — timeline is unlocked."
                            : `${missing} label${missing === 1 ? "" : "s"} still need an icon.`}
                    </p>
                </div>
            </Modal>

            {picker && (
                <IconPicker
                    open={true}
                    label={picker.label}
                    current={picker.current}
                    onClose={() => setPicker(null)}
                    onPick={pick}
                />
            )}
        </>
    )
}
