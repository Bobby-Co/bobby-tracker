"use client"

import { useMemo, useState } from "react"
import { cn } from "@/components/cn"
import { IconlyIcon } from "@/components/iconly-icon"
import { Modal } from "@/components/modal"
import { ICONLY_ICONS } from "@/lib/iconly"
import {
    LABEL_COLOR_PALETTE,
    defaultLabelColor,
    softLabelChipStyle,
} from "@/lib/timeline/labels"

// NewLabelModal — compact create-label dialog. Shows a live
// preview of the label chip in the middle so the user can see
// the result of their name / icon / colour choices before
// committing. Used by the issue editor's label tray's "+ New".
export function NewLabelModal({
    open,
    onClose,
    existingLabels,
    onCreate,
}: {
    open: boolean
    onClose: () => void
    /** Lower-cased names already configured on the project, used
     *  to surface a duplicate-name warning inline. */
    existingLabels: Set<string>
    /** Called with the trimmed name + chosen Iconly icon name +
     *  selected colour. Resolves when the parent has saved. */
    onCreate: (name: string, iconName: string, color: string) => Promise<void> | void
}) {
    const [name, setName] = useState("")
    const [iconName, setIconName] = useState<string | null>(null)
    const [color, setColor] = useState<string>(LABEL_COLOR_PALETTE[0])
    const [search, setSearch] = useState("")
    const [submitting, setSubmitting] = useState(false)
    // While the user hasn't manually picked a colour, gently
    // follow the hash-default for the typed name so the preview
    // still feels alive. Tracked via a sentinel.
    const [colorTouched, setColorTouched] = useState(false)

    // Reset when the modal closes so the next open starts fresh.
    // Done via the "adjust state on prop change" idiom rather
    // than an effect to satisfy the set-state-in-effect rule.
    const [seenOpen, setSeenOpen] = useState(open)
    if (seenOpen !== open) {
        setSeenOpen(open)
        if (!open) {
            setName("")
            setIconName(null)
            setColor(LABEL_COLOR_PALETTE[0])
            setSearch("")
            setSubmitting(false)
            setColorTouched(false)
        }
    }
    const previewColor = colorTouched ? color : (name.trim() ? defaultLabelColor(name.trim()) : color)

    const trimmed = name.trim()
    const isDuplicate = !!trimmed && existingLabels.has(trimmed.toLowerCase())
    const canCreate = !!trimmed && !!iconName && !isDuplicate && !submitting

    const filtered = useMemo(() => {
        const needle = search.trim().toLowerCase()
        if (!needle) return ICONLY_ICONS
        return ICONLY_ICONS.filter((i) =>
            i.name.includes(needle) || i.keywords.some((k) => k.includes(needle)),
        )
    }, [search])

    async function submit() {
        if (!canCreate || !iconName) return
        setSubmitting(true)
        try {
            await onCreate(trimmed, iconName, previewColor)
        } finally {
            setSubmitting(false)
        }
    }

    const previewLabel = trimmed || "label"
    const tint = softLabelChipStyle(previewColor)

    return (
        <Modal open={open} onClose={() => onClose} title="Create label" size="sm">
            <div className="flex flex-col gap-4">
                {/* Live preview — sized up so the user can see
                    the icon and colour clearly. */}
                <div className="flex items-center justify-center py-2">
                    <span
                        className="inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-[14px] font-semibold"
                        style={tint}
                    >
                        <IconlyIcon name={iconName} size={16} />
                        <span className="max-w-[180px] truncate">{previewLabel}</span>
                    </span>
                </div>

                <div>
                    <input
                        autoFocus
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter" && canCreate) { e.preventDefault(); void submit() } }}
                        placeholder="Label name"
                        className="w-full rounded-[10px] border border-[color:var(--c-border)] bg-white px-3 py-2 text-[13px] outline-none focus:border-zinc-400"
                    />
                    {isDuplicate && (
                        <p className="mt-1 text-[11px] text-rose-600">
                            Already exists — pick it from the tray.
                        </p>
                    )}
                </div>

                {/* Colour palette */}
                <div>
                    <div className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-[color:var(--c-text-muted)]">
                        Colour
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                        {LABEL_COLOR_PALETTE.map((c) => {
                            const active = previewColor === c
                            return (
                                <button
                                    key={c}
                                    type="button"
                                    onClick={() => { setColor(c); setColorTouched(true) }}
                                    className={cn(
                                        "h-6 w-6 rounded-full transition-all",
                                        active ? "ring-2 ring-zinc-900 ring-offset-2" : "ring-1 ring-black/10 hover:ring-zinc-400",
                                    )}
                                    style={{ background: c }}
                                    aria-label={`Colour ${c}`}
                                    title={c}
                                />
                            )
                        })}
                    </div>
                </div>

                {/* Icon picker */}
                <div>
                    <div className="mb-1.5 flex items-center justify-between text-[10px] font-bold uppercase tracking-[0.12em] text-[color:var(--c-text-muted)]">
                        <span>Icon</span>
                        <input
                            type="search"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder="Search…"
                            className="w-32 rounded-md border border-[color:var(--c-border)] bg-white px-2 py-0.5 text-[11px] font-medium normal-case tracking-normal text-[color:var(--c-text)] outline-none focus:border-zinc-400"
                        />
                    </div>
                    <div
                        className="grid max-h-[180px] gap-1.5 overflow-y-auto pr-1"
                        style={{ gridTemplateColumns: "repeat(auto-fill, minmax(48px, 1fr))" }}
                    >
                        {filtered.map((icon) => {
                            const active = iconName === icon.name
                            return (
                                <button
                                    key={icon.name}
                                    type="button"
                                    onClick={() => setIconName(icon.name)}
                                    className={cn(
                                        "grid h-10 place-items-center rounded-[8px] border transition-colors",
                                        active
                                            ? "border-zinc-900 bg-zinc-900 text-white"
                                            : "border-[color:var(--c-border)] bg-white text-[color:var(--c-text-muted)] hover:border-zinc-400 hover:text-[color:var(--c-text)]",
                                    )}
                                    title={icon.name}
                                >
                                    <IconlyIcon name={icon.name} size={18} />
                                </button>
                            )
                        })}
                        {filtered.length === 0 && (
                            <div className="col-span-full rounded-[8px] border border-dashed border-[color:var(--c-border)] px-3 py-4 text-center text-[11.5px] text-[color:var(--c-text-muted)]">
                                No icons match.
                            </div>
                        )}
                    </div>
                </div>

                <div className="flex items-center justify-end gap-2">
                    <button
                        type="button"
                        onClick={onClose}
                        className="rounded-[10px] border border-[color:var(--c-border)] bg-white px-3 py-2 text-[12.5px] font-semibold hover:bg-[color:var(--c-overlay)]"
                    >
                        Cancel
                    </button>
                    <button
                        type="button"
                        onClick={submit}
                        disabled={!canCreate}
                        className="rounded-[10px] bg-zinc-900 px-4 py-2 text-[12.5px] font-semibold text-white hover:bg-zinc-800 disabled:opacity-50"
                    >
                        {submitting ? "Creating…" : "Create"}
                    </button>
                </div>
            </div>
        </Modal>
    )
}
