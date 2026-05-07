"use client"

import { useMemo, useState } from "react"
import { cn } from "@/components/cn"
import { IconlyIcon } from "@/components/iconly-icon"
import { Modal } from "@/components/modal"
import { ICONLY_ICONS } from "@/lib/iconly"

// IconPicker — searchable gallery for assigning an icon to a label.
// Renders the full Iconly Bold set in a dense grid; the search box
// matches both name and keywords. Calls onPick with the canonical
// icon name and lets the parent persist.
export function IconPicker({
    open,
    label,
    current,
    onClose,
    onPick,
}: {
    open: boolean
    label: string
    current: string | null
    onClose: () => void
    onPick: (iconName: string) => void
}) {
    const [q, setQ] = useState("")
    const filtered = useMemo(() => {
        const needle = q.trim().toLowerCase()
        if (!needle) return ICONLY_ICONS
        return ICONLY_ICONS.filter((i) =>
            i.name.includes(needle) || i.keywords.some((k) => k.includes(needle)),
        )
    }, [q])

    return (
        <Modal
            open={open}
            onClose={onClose}
            title={`Choose an icon for "${label}"`}
            description="Iconly Bold. Used wherever this label appears on the timeline."
            size="lg"
        >
            <div className="flex flex-col gap-4">
                <input
                    type="search"
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder="Search icons (e.g. bug, auth, calendar)…"
                    className="w-full rounded-[10px] border border-[color:var(--c-border)] bg-white px-3 py-2 text-[13px] outline-none focus:border-zinc-400"
                />
                <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(72px, 1fr))" }}>
                    {filtered.map((icon) => {
                        const active = current === icon.name
                        return (
                            <button
                                key={icon.name}
                                type="button"
                                onClick={() => onPick(icon.name)}
                                className={cn(
                                    "group flex flex-col items-center gap-1 rounded-[10px] border px-2 py-3 text-[10.5px] font-medium transition-colors",
                                    active
                                        ? "border-zinc-900 bg-zinc-900 text-white"
                                        : "border-[color:var(--c-border)] bg-white text-[color:var(--c-text-muted)] hover:border-zinc-400 hover:text-[color:var(--c-text)]",
                                )}
                                title={icon.name}
                            >
                                <IconlyIcon name={icon.name} size={22} />
                                <span className="line-clamp-1 break-all">{icon.name}</span>
                            </button>
                        )
                    })}
                    {filtered.length === 0 && (
                        <div className="col-span-full rounded-[10px] border border-dashed border-[color:var(--c-border)] px-4 py-6 text-center text-[12.5px] text-[color:var(--c-text-muted)]">
                            No icons match “{q}”.
                        </div>
                    )}
                </div>
            </div>
        </Modal>
    )
}
