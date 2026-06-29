"use client"

import { useEffect, useRef, useState, type ReactNode } from "react"
import { motion, useMotionValue, useSpring, useTransform } from "framer-motion"
import { MiniIcon, type Tone } from "@/components/field-card"

// Notification popover for the topbar. The bell "chip" MORPHS into the panel
// using the exact technique from the analyser effort selector
// (components/issue-suggestions.tsx): ONE absolutely-positioned surface whose
// real width/height/border-radius/box-shadow animate between a measured chip
// and panel size, with the chip and panel layers cross-fading on top (content
// fades IN after the box grows, OUT before it shrinks). No transform scale, so
// nothing distorts. Mock data for now — wire a real feed later.

type Notif = {
    id: string
    tone: Tone
    icon: ReactNode
    title: string
    meta: string
    time: string
    unread?: boolean
}

const SECTIONS: { label: string; items: Notif[] }[] = [
    {
        label: "New",
        items: [
            { id: "n1", tone: "rose", icon: <AlertIcon />, title: "Critical issue opened", meta: "Atlas API · #142", time: "2m", unread: true },
            { id: "n2", tone: "violet", icon: <PrGlyph />, title: "Sam requested your review", meta: "Web Portal · PR #88", time: "18m", unread: true },
        ],
    },
    {
        label: "Earlier",
        items: [
            { id: "n3", tone: "emerald", icon: <CheckGlyph />, title: "CI passed on main", meta: "Bobby-ui · #134", time: "1h" },
            { id: "n4", tone: "blue", icon: <CommentIcon />, title: "New comment from Alex", meta: "Mobile App · #98", time: "3h" },
            { id: "n5", tone: "amber", icon: <RocketIcon />, title: "Deployment finished", meta: "Billing Service", time: "1d" },
        ],
    },
]

const UNREAD = SECTIONS.flatMap((s) => s.items).filter((n) => n.unread).length

// The bell's footprint — width/height never animate below this, so the icon
// can't spill out of a too-small box during the close bounce.
const FLOOR = 36
// One bouncy spring for BOTH directions. The clamp (below) keeps the close
// bounce from undershooting past the bell; on open it overshoots a touch larger
// (the "force"). Tune damping for more/less bounce.
const SIZE_SPRING = { stiffness: 420, damping: 20, mass: 0.78 }

export function NotificationPopover() {
    const [open, setOpen] = useState(false)
    const wrapRef = useRef<HTMLDivElement>(null)
    const chipRef = useRef<HTMLButtonElement>(null)
    const panelRef = useRef<HTMLDivElement>(null)
    const [chipSize, setChipSize] = useState({ w: 36, h: 36 })
    const [panelSize, setPanelSize] = useState({ w: 340, h: 420 })

    // Width/height ride springs (open AND close), CLAMPED to the bell's footprint
    // so the box can bounce but never shrinks below it. useSpring reads a raw
    // number arg only ONCE (as its initial) — a changing `open ? a : b` never
    // re-targets, so the box never grew on open. Feed it motion-value TARGETS and
    // .set() them on open/close instead, which makes the spring re-animate.
    const wTarget = useMotionValue(FLOOR)
    const hTarget = useMotionValue(FLOOR)
    const wSpring = useSpring(wTarget, SIZE_SPRING)
    const hSpring = useSpring(hTarget, SIZE_SPRING)
    const width = useTransform(wSpring, (v) => (v < FLOOR ? FLOOR : v))
    const height = useTransform(hSpring, (v) => (v < FLOOR ? FLOOR : v))
    useEffect(() => {
        wTarget.set(open ? panelSize.w : chipSize.w)
        hTarget.set(open ? panelSize.h : chipSize.h)
    }, [open, panelSize.w, panelSize.h, chipSize.w, chipSize.h, wTarget, hTarget])

    // Measure the chip + panel so the surface morphs to either exactly, and
    // stays correct if content reflows.
    useEffect(() => {
        const ro = new ResizeObserver((entries) => {
            for (const e of entries) {
                const el = e.target as HTMLElement
                const size = { w: el.offsetWidth, h: el.offsetHeight }
                if (el === chipRef.current) setChipSize(size)
                else if (el === panelRef.current) setPanelSize(size)
            }
        })
        if (chipRef.current) ro.observe(chipRef.current)
        if (panelRef.current) ro.observe(panelRef.current)
        return () => ro.disconnect()
    }, [])

    // Dismiss on outside click or Escape.
    useEffect(() => {
        if (!open) return
        function onDown(e: MouseEvent) {
            if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
        }
        function onKey(e: KeyboardEvent) {
            if (e.key === "Escape") setOpen(false)
        }
        document.addEventListener("mousedown", onDown)
        document.addEventListener("keydown", onKey)
        return () => {
            document.removeEventListener("mousedown", onDown)
            document.removeEventListener("keydown", onKey)
        }
    }, [open])

    return (
        <div className="relative" ref={wrapRef}>
            {/* Placeholder holds the bell's footprint so the topbar doesn't shift
                when the absolutely-positioned surface morphs. */}
            <span aria-hidden className="block h-9 w-9" />

            {/* The morphing surface — anchored to the bell's top-right corner so
                it grows down + left into a dropdown. */}
            <motion.div
                className="absolute right-0 top-0 z-50 origin-top-right overflow-hidden border border-[color:var(--c-border)] bg-[color:var(--c-surface)]"
                initial={false}
                whileTap={{ scale: 0.9 }}
                // width/height are the CLAMPED springs (bounce both ways, never
                // below the bell). borderRadius/shadow tween; scale is the tap
                // squish (its own snappy spring).
                style={{ width, height }}
                animate={{
                    borderRadius: open ? 16 : 10,
                    boxShadow: open
                        ? "0 12px 32px -8px rgba(15,23,42,0.18), 0 2px 6px rgba(15,23,42,0.06)"
                        : "0 1px 1px rgba(17,24,39,0.04), 0 0px 0px rgba(15,23,42,0)",
                }}
                transition={{
                    scale: { type: "spring", stiffness: 600, damping: 18, mass: 0.6 },
                    borderRadius: { type: "tween", duration: 0.2, ease: [0.22, 0.8, 0.26, 1] },
                    boxShadow: { type: "tween", duration: 0.28, ease: "easeOut" },
                }}
            >
                {/* Chip layer — the bell. Fades out immediately on open, back in
                    after the box finishes shrinking on close. */}
                <button
                    ref={chipRef}
                    type="button"
                    onClick={() => setOpen(true)}
                    aria-haspopup="dialog"
                    aria-expanded={open}
                    aria-label={`Notifications${UNREAD ? `, ${UNREAD} unread` : ""}`}
                    className="absolute right-0 top-0 grid h-9 w-9 place-items-center text-[color:var(--c-text-muted)] transition-colors hover:bg-[color:var(--c-overlay)] hover:text-[color:var(--c-text)]"
                    style={{
                        opacity: open ? 0 : 1,
                        pointerEvents: open ? "none" : "auto",
                        transition: "opacity .14s ease",
                        transitionDelay: open ? "0s" : ".16s",
                    }}
                >
                    <BellIcon />
                    {UNREAD > 0 && (
                        <span className="absolute right-[9px] top-[8px] h-2 w-2 rounded-full bg-[color:var(--c-primary)] ring-2 ring-[color:var(--c-surface)]" />
                    )}
                </button>

                {/* Panel layer — fades in after the box has grown, out immediately
                    on close. Fixed width; height is measured. */}
                <div
                    ref={panelRef}
                    role="dialog"
                    aria-label="Notifications"
                    className="absolute right-0 top-0 w-[340px]"
                    style={{
                        opacity: open ? 1 : 0,
                        pointerEvents: open ? "auto" : "none",
                        transition: "opacity .14s ease",
                        transitionDelay: open ? ".16s" : "0s",
                    }}
                >
                    <div className="flex items-center justify-between border-b border-[color:var(--c-border)] px-4 py-3">
                        <div className="flex items-center gap-2">
                            <span className="text-[13px] font-bold tracking-[-0.01em]">Notifications</span>
                            {UNREAD > 0 && (
                                <span className="rounded-full bg-[color:var(--c-primary)] px-1.5 py-px text-[10px] font-bold tabular-nums text-white">
                                    {UNREAD} new
                                </span>
                            )}
                        </div>
                        <button
                            type="button"
                            tabIndex={open ? 0 : -1}
                            className="text-[11.5px] font-semibold text-[color:var(--c-text-muted)] transition-colors hover:text-[color:var(--c-text)]"
                        >
                            Mark all read
                        </button>
                    </div>

                    <div className="max-h-[320px] overflow-y-auto py-1">
                        {SECTIONS.map((section) => (
                            <div key={section.label}>
                                <div className="px-4 pb-1 pt-2.5 text-[10.5px] font-semibold uppercase tracking-[0.06em] text-[color:var(--c-text-dim)]">
                                    {section.label}
                                </div>
                                <ul>
                                    {section.items.map((n) => (
                                        <li key={n.id}>
                                            <button
                                                type="button"
                                                tabIndex={open ? 0 : -1}
                                                className="flex w-full items-start gap-3 px-4 py-2.5 text-left transition-colors hover:bg-[color:var(--c-overlay)]"
                                            >
                                                <MiniIcon tone={n.tone} size={30}>
                                                    {n.icon}
                                                </MiniIcon>
                                                <span className="min-w-0 flex-1">
                                                    <span className="block truncate text-[12.5px] font-semibold text-[color:var(--c-text)]">
                                                        {n.title}
                                                    </span>
                                                    <span className="block truncate text-[11.5px] text-[color:var(--c-text-muted)]">
                                                        {n.meta}
                                                    </span>
                                                </span>
                                                <span className="flex shrink-0 items-center gap-1.5 pt-0.5">
                                                    <span className="text-[11px] tabular-nums text-[color:var(--c-text-dim)]">{n.time}</span>
                                                    {n.unread && <span className="h-1.5 w-1.5 rounded-full bg-[color:var(--c-primary)]" />}
                                                </span>
                                            </button>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        ))}
                    </div>

                    <div className="border-t border-[color:var(--c-border)] p-1.5">
                        <button
                            type="button"
                            tabIndex={open ? 0 : -1}
                            className="w-full rounded-[10px] py-2 text-center text-[12px] font-semibold text-[color:var(--c-primary)] transition-colors hover:bg-[color:var(--c-primary-tint)]"
                        >
                            View all notifications
                        </button>
                    </div>
                </div>
            </motion.div>
        </div>
    )
}

// ── icons ────────────────────────────────────────────────────────────────
function BellIcon() {
    return (
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
            <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
    )
}
function AlertIcon() {
    return (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M12 8v5" />
            <circle cx="12" cy="16.5" r="0.6" fill="currentColor" stroke="none" />
            <circle cx="12" cy="12" r="9" />
        </svg>
    )
}
function PrGlyph() {
    return (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <circle cx="6" cy="6" r="2.2" />
            <circle cx="6" cy="18" r="2.2" />
            <circle cx="18" cy="18" r="2.2" />
            <path d="M6 8.2v7.6M18 15.8V13a3 3 0 0 0-3-3H9" />
        </svg>
    )
}
function CheckGlyph() {
    return (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M20 6 9 17l-5-5" />
        </svg>
    )
}
function CommentIcon() {
    return (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M21 11.5a8.5 8.5 0 0 1-12.3 7.6L3 21l1.9-5.7A8.5 8.5 0 1 1 21 11.5z" />
        </svg>
    )
}
function RocketIcon() {
    return (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M5 15c-1.5 1.3-2 5-2 5s3.7-.5 5-2M9 11a8 8 0 0 1 9-7 8 8 0 0 1-7 9l-4 4-2-2 4-4z" />
            <circle cx="14.5" cy="8.5" r="1.3" />
        </svg>
    )
}
