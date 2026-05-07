"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { AnimatePresence, motion } from "framer-motion"
import { IconlyIcon } from "@/components/iconly-icon"
import { NewLabelModal } from "@/components/new-label-modal"
import { defaultLabelColor, softLabelChipStyle } from "@/lib/timeline/labels"
import type { ProjectLabelIcon } from "@/lib/supabase/types"

// Single transition reused across chip layout / enter / exit.
// Stiff spring keeps reflow snappy without bouncing — bouncing
// is what made earlier versions feel jiggly.
const CHIP_TRANSITION = { type: "spring", stiffness: 520, damping: 40, mass: 0.55 } as const

// LabelsEditor — chip-based label picker. Layout:
//   • Top row: chips for labels currently on the issue. Hovering
//     a chip reveals a small × that removes the label.
//   • Tray: every other configured label in the project, shown
//     as soft-tinted chips with a `+` affordance, plus a final
//     "+ New" button that opens NewLabelModal.
//
// Lives in its own file (rather than alongside IssueDetail) so
// it stays self-contained — its render lifecycle is decoupled
// from the surrounding form, which previously caused a stream
// of "ghost-hover" / glitchy interactions when IssueDetail
// re-rendered for unrelated reasons (status / priority writes,
// router refreshes).
export function LabelsEditor({
    value,
    labelIcons,
    projectId,
    onChange,
}: {
    value: string[]
    labelIcons: ProjectLabelIcon[]
    projectId?: string
    onChange: (next: string[]) => void
}) {
    const router = useRouter()
    const [creating, setCreating] = useState(false)

    const labelIconMap = useMemo(() => {
        const m = new Map<string, ProjectLabelIcon>()
        for (const i of labelIcons) m.set(i.label, i)
        return m
    }, [labelIcons])

    const assigned = new Set(value)
    const reuseable = labelIcons
        .map((i) => i.label)
        .filter((l) => !assigned.has(l))
        .sort()

    const existing = useMemo(() => {
        const s = new Set<string>()
        for (const i of labelIcons) s.add(i.label.toLowerCase())
        return s
    }, [labelIcons])

    function add(label: string) {
        const trimmed = label.trim()
        if (!trimmed || assigned.has(trimmed)) return
        onChange([...value, trimmed])
    }
    function remove(label: string) {
        onChange(value.filter((l) => l !== label))
    }

    async function createLabel(name: string, iconName: string, color: string) {
        if (!projectId) return
        const res = await fetch(`/api/projects/${projectId}/label-icons`, {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ label: name, icon_name: iconName, color }),
        })
        if (!res.ok) return
        // Attach the new label to this issue and refresh server
        // data so labelIcons picks up the new row.
        onChange([...value, name])
        setCreating(false)
        router.refresh()
    }

    useEffect(() => {
        console.log(creating)
    }, [creating]);

    return (
        <div className="flex flex-col gap-3">
            {/* Current labels on this issue. AnimatePresence with
                popLayout = exiting chips drop out of the flex
                layout immediately so the survivors FLIP into the
                new positions instead of waiting for the exit
                animation to complete. */}
            <motion.div layout className="flex min-h-[24px] flex-wrap items-center gap-1.5">
                {value.length === 0 && (
                    <span className="text-[11.5px] italic text-[color:var(--c-text-dim)]">
                        No labels on this issue yet — pick one below or create a new label.
                    </span>
                )}
                <AnimatePresence mode="popLayout" initial={false}>
                    {value.map((l) => (
                        <SoftChip
                            key={l}
                            label={l}
                            cfg={labelIconMap.get(l)}
                            mode="assigned"
                            onClick={() => remove(l)}
                        />
                    ))}
                </AnimatePresence>
            </motion.div>

            {(value.length > 0 || reuseable.length > 0) && (
                <div className="border-t border-[color:var(--c-border)]" />
            )}

            {/* Tray — reuseable chips + "+ New" button. */}
            <motion.div layout className="flex flex-wrap items-center gap-1.5">
                {reuseable.length === 0 && value.length === 0 && (
                    <span className="text-[11.5px] italic text-[color:var(--c-text-dim)]">
                        This project has no labels yet.
                    </span>
                )}
                <AnimatePresence mode="popLayout" initial={false}>
                    {reuseable.map((l) => (
                        <SoftChip
                            key={l}
                            label={l}
                            cfg={labelIconMap.get(l)}
                            mode="reuse"
                            onClick={() => add(l)}
                        />
                    ))}
                </AnimatePresence>
                {projectId && (
                    <motion.span
                        layout="position"
                        onClick={() => setCreating(true)}
                        className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-[color:var(--c-border)] bg-white px-2.5 py-[3px] cursor-pointer text-[11px] font-semibold text-[color:var(--c-text-muted)] hover:border-zinc-400 hover:bg-[color:var(--c-overlay)] hover:text-[color:var(--c-text)]"
                    >
                        <span aria-hidden>+</span>
                        New
                    </motion.span>
                )}
            </motion.div>

            {projectId && (
                <NewLabelModal
                    open={creating}
                    onClose={() => {setCreating(false)}}
                    existingLabels={existing}
                    onCreate={createLabel}
                />
            )}
        </div>
    )
}

// SoftChip — motion.span with border + padding. `assigned` mode
// shows an X on hover (click = remove); `reuse` mode shows a +
// (click = attach). The action is rendered conditionally inside
// AnimatePresence so its width / opacity animate in and out, and
// the chip's `layout` prop FLIPs the chip's own width to match
// (so the chip widens smoothly as the X reveals). Sibling chips
// in the parent's AnimatePresence + layout container shift into
// place via the same FLIP system — no negative margins needed.
function SoftChip({
    label,
    cfg,
    mode,
    onClick,
}: {
    label: string
    cfg: ProjectLabelIcon | undefined
    mode: "assigned" | "reuse"
    onClick: () => void
}) {
    const color = cfg?.color ?? defaultLabelColor(label)
    const tint = softLabelChipStyle(color)
    const isAssigned = mode === "assigned"
    const [hovered, setHovered] = useState(false)

    return (
        <motion.span
            layout={"x"}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={CHIP_TRANSITION}
            className="inline-flex items-center gap-1.5 rounded-full border pl-2 pr-2 h-6 text-[11px] font-semibold"
            style={tint}
        >
            <motion.div layout={"position"} className="flex items-center gap-1 overflow-hidden">
                <IconlyIcon name={cfg?.icon_name ?? null} size={11} />
                <span>{label}</span>
            </motion.div>
            <AnimatePresence initial={false}>
                {hovered && (
                    <motion.span
                        key="action"
                        role="button"
                        tabIndex={0}
                        onClick={onClick}
                        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick() } }}
                        aria-label={isAssigned ? `Remove label ${label}` : `Add label ${label}`}
                        title={isAssigned ? "Remove" : "Add"}
                        initial={{ width: 0, opacity: 0 }}
                        animate={{ width: 12, opacity: 1 }}
                        exit={{ width: 0, opacity: 0 }}
                        transition={{ duration: 0.15, ease: "easeOut" }}
                        className="flex h-4 shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-full hover:bg-black/15"
                    >
                        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden>
                            {isAssigned
                                ? <path d="M6 6l12 12M18 6L6 18" />
                                : <path d="M12 6v12M6 12h12" />}
                        </svg>
                    </motion.span>
                )}
            </AnimatePresence>
        </motion.span>
    )
}
