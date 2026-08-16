"use client"

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react"
import { useRouter } from "next/navigation"
// `m`, not `motion` — this sits in the topbar, i.e. on every authed page.
// The motion-value hooks below are core and load eagerly regardless.
// See components/ui/lazy-motion.tsx.
import { m, useAnimationControls, useMotionValue, useReducedMotion, useSpring, useTransform } from "framer-motion"
import { MiniIcon, type Tone } from "@/components/ui/field-card"
import { timeAgo } from "@/components/issues/issue-meta"
import { createClient } from "@/lib/client/supabase"
import { apiMutate } from "@/lib/client/http/api-client"
import type { Notification, NotificationKind } from "@/lib/shared/types"

// Notification popover for the topbar. The bell "chip" MORPHS into the panel
// using the exact technique from the analyser effort selector
// (components/issue-suggestions.tsx): ONE absolutely-positioned surface whose
// real width/height/border-radius/box-shadow animate between a measured chip
// and panel size, with the chip and panel layers cross-fading on top (content
// fades IN after the box grows, OUT before it shrinks). No transform scale, so
// nothing distorts.
//
// The feed is tracker.notifications (migration 0049), written entirely by DB
// triggers — see that migration for why the events can't be emitted from route
// handlers. This component only reads, marks read, and deletes.
//
// NO BANNER / TOAST: an arriving notification animates the bell and nothing
// else. The row is already in the tray by the time the swing finishes, so the
// bell is the notice — there is deliberately no interrupting surface to dismiss.

// Icon + tone live here, not in the database: the row records what happened,
// the client decides how it looks. Same split as issue-meta.tsx's status/
// priority vocabulary.
const KIND_STYLE: Record<NotificationKind, { tone: Tone; icon: ReactNode }> = {
    // The first index is the payoff moment — the rocket + emerald is the only
    // celebratory pairing in the tray, and it can only ever fire once per project.
    kb_ready:          { tone: "emerald", icon: <RocketIcon /> },
    kb_updated:        { tone: "blue",    icon: <RefreshIcon /> },
    pr_analysis_ready: { tone: "violet",  icon: <CheckGlyph /> },
    pr_opened:         { tone: "indigo",  icon: <PrGlyph /> },
}

// Fallback for a kind added to the DB before this map catches up — an unstyled
// row still beats a crash in the topbar of every page.
const FALLBACK_STYLE = { tone: "zinc" as Tone, icon: <BellIcon /> }

// The bell's footprint — width/height never animate below this, so the icon
// can't spill out of a too-small box during the close bounce.
const FLOOR = 36
// One bouncy spring for BOTH directions. The clamp (below) keeps the close
// bounce from undershooting past the bell; on open it overshoots a touch larger
// (the "force"). Tune damping for more/less bounce.
const SIZE_SPRING = { stiffness: 420, damping: 20, mass: 0.78 }

export function NotificationPopover() {
    const router = useRouter()
    const [open, setOpen] = useState(false)
    const [items, setItems] = useState<Notification[]>([])
    const [loaded, setLoaded] = useState(false)
    const wrapRef = useRef<HTMLDivElement>(null)
    const chipRef = useRef<HTMLButtonElement>(null)
    const panelRef = useRef<HTMLDivElement>(null)
    const [chipSize, setChipSize] = useState({ w: 36, h: 36 })
    const [panelSize, setPanelSize] = useState({ w: 340, h: 420 })

    const unread = items.filter((n) => n.read_at === null).length

    // ── the bell swing ──────────────────────────────────────────────────────
    // The whole "user is online" affordance. Driven imperatively rather than by
    // an `animate` prop because it's a one-shot reaction to an event, not a
    // state the bell rests in.
    const swing = useAnimationControls()
    const reducedMotion = useReducedMotion()
    const ring = useCallback(() => {
        // Respect the OS setting: the row still arrives, it just doesn't move.
        // The unread dot carries the signal on its own.
        if (reducedMotion) return
        void swing.start({
            rotate: [0, -14, 11, -8, 5, -2, 0],
            transition: { duration: 0.75, ease: "easeInOut" },
        })
    }, [swing, reducedMotion])

    // ── initial feed ────────────────────────────────────────────────────────
    useEffect(() => {
        let cancelled = false
        ;(async () => {
            try {
                const res = await fetch("/api/notifications", {
                    cache: "no-store",
                    credentials: "same-origin",
                })
                // A 401 is expected, not exceptional: AppShell (and therefore this
                // bell) also renders in the unauthenticated app/preview/* harness.
                // An empty tray is the honest result there — don't shout about it
                // in the topbar of a page the user came to for something else.
                if (!res.ok || cancelled) return
                const body = (await res.json()) as { notifications: Notification[] }
                if (!cancelled) setItems(body.notifications ?? [])
            } catch {
                // Offline / aborted — same reasoning as above.
            } finally {
                if (!cancelled) setLoaded(true)
            }
        })()
        return () => { cancelled = true }
    }, [])

    // ── live arrivals ───────────────────────────────────────────────────────
    // NOTE the missing `filter:` — deliberate, and the reason this component
    // needs no user id (it can't get one: useAuth() throws outside AuthProvider,
    // and the preview harness mounts AppShell without one). Realtime enforces
    // RLS per subscriber, and notifications_owner_select (0049) is
    // `user_id = auth.uid()` — so "every row this connection can see" is already
    // exactly "this user's notifications". The other call sites pass a filter
    // because they scope to one issue, which RLS alone wouldn't narrow.
    //
    // No polling fallback, unlike issue-suggestions.tsx: there, a dropped WAL
    // event strands the user on a spinner. Here the cost is a bell that swings
    // late — the feed is re-fetched on mount, so a missed event resolves on the
    // next navigation. Not worth a timer on every page.
    useEffect(() => {
        const supabase = createClient()
        const channel = supabase
            .channel("notifications-feed")
            .on(
                "postgres_changes",
                { event: "INSERT", schema: "tracker", table: "notifications" },
                (payload) => {
                    const row = payload.new as Notification
                    setItems((prev) => (prev.some((n) => n.id === row.id) ? prev : [row, ...prev]))
                    ring()
                },
            )
            .subscribe()
        return () => { void supabase.removeChannel(channel) }
    }, [ring])

    // ── actions ─────────────────────────────────────────────────────────────
    // All three mutate local state first and let the request settle in the
    // background. Every endpoint is idempotent and the tray is not a system of
    // record, so a failed write costs at most a stale row until the next load —
    // cheaper than making the user watch a spinner to dismiss something.
    const dismiss = useCallback(async (id: string) => {
        setItems((prev) => prev.filter((n) => n.id !== id))
        try {
            await apiMutate(`/api/notifications/${id}`, { method: "DELETE" })
        } catch {}
    }, [])

    const markAllRead = useCallback(async () => {
        if (!unread) return
        const now = new Date().toISOString()
        setItems((prev) => prev.map((n) => (n.read_at ? n : { ...n, read_at: now })))
        try {
            await apiMutate("/api/notifications", { method: "PATCH" })
        } catch {}
    }, [unread])

    const openItem = useCallback(async (n: Notification) => {
        setOpen(false)
        if (n.read_at === null) {
            const now = new Date().toISOString()
            setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, read_at: now } : x)))
            try {
                await apiMutate(`/api/notifications/${n.id}`, { method: "PATCH" })
            } catch {}
        }
        if (n.href) router.push(n.href)
    }, [router])

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
    // stays correct if content reflows (it now does — the list is live).
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

    // Unread on top, everything else below — the read_at split IS the section
    // split, so "New" can't disagree with the badge count.
    const sections = [
        { label: "New", items: items.filter((n) => n.read_at === null) },
        { label: "Earlier", items: items.filter((n) => n.read_at !== null) },
    ].filter((s) => s.items.length > 0)

    return (
        <div className="relative" ref={wrapRef}>
            {/* Placeholder holds the bell's footprint so the topbar doesn't shift
                when the absolutely-positioned surface morphs. */}
            <span aria-hidden className="block h-9 w-9" />

            {/* The morphing surface — anchored to the bell's top-right corner so
                it grows down + left into a dropdown. */}
            <m.div
                // The rounding + resting shadow are ALSO set in CSS here, matching the
                // closed values in `animate` below. `initial={false}` means motion only
                // applies them once its features have loaded (now asynchronous), so
                // without this baseline the bell renders as a hard-cornered, shadowless
                // square for the first moments of every page. Once loaded, motion's
                // inline style takes over and these are overridden.
                // anim-fade eases the bell in on mount. The shell reserves its
                // footprint but draws nothing there (no session yet to open a
                // realtime channel for), so without this the bell simply appeared
                // in that gap. Safe alongside motion here: motion animates
                // borderRadius and boxShadow on this element, never opacity.
                className="anim-fade absolute right-0 top-0 z-50 origin-top-right overflow-hidden rounded-[10px] border border-[color:var(--c-border)] bg-[color:var(--c-surface)] shadow-[0_1px_1px_rgba(17,24,39,0.04)]"
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
                    aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`}
                    className="absolute right-0 top-0 grid h-9 w-9 place-items-center text-[color:var(--c-text-muted)] transition-colors hover:bg-[color:var(--c-overlay)] hover:text-[color:var(--c-text)]"
                    style={{
                        opacity: open ? 0 : 1,
                        pointerEvents: open ? "none" : "auto",
                        transition: "opacity .14s ease",
                        transitionDelay: open ? "0s" : ".16s",
                    }}
                >
                    {/* Only the glyph swings — the button itself is the hit area and
                        must stay put. Pivot at the bell's crown so it pendulums from
                        its mount instead of spinning about its middle. */}
                    <m.span
                        animate={swing}
                        style={{ transformOrigin: "50% 18%" }}
                        className="grid place-items-center"
                    >
                        <BellIcon />
                    </m.span>
                    {unread > 0 && (
                        // CSS, not motion: motion's features load after first
                        // paint, so a motion-driven entrance would not run for the
                        // very appearance that matters — the dot arriving when the
                        // first fetch resolves. The animation is tied to the
                        // element mounting, so it plays when the dot appears and
                        // not when the count merely changes.
                        <span className="anim-ping-in absolute right-[9px] top-[8px] h-2 w-2 rounded-full bg-[color:var(--c-primary)] ring-2 ring-[color:var(--c-surface)]" />
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
                            {unread > 0 && (
                                <span className="rounded-full bg-[color:var(--c-primary)] px-1.5 py-px text-[10px] font-bold tabular-nums text-white">
                                    {unread} new
                                </span>
                            )}
                        </div>
                        {unread > 0 && (
                            <button
                                type="button"
                                onClick={markAllRead}
                                tabIndex={open ? 0 : -1}
                                className="text-[11.5px] font-semibold text-[color:var(--c-text-muted)] transition-colors hover:text-[color:var(--c-text)]"
                            >
                                Mark all read
                            </button>
                        )}
                    </div>

                    <div className="max-h-[320px] min-h-[96px] overflow-y-auto py-1">
                        {sections.length === 0 ? (
                            <p className="px-4 py-9 text-center text-[12px] text-[color:var(--c-text-dim)]">
                                {loaded ? "You're all caught up." : "Loading…"}
                            </p>
                        ) : (
                            sections.map((section) => (
                                <div key={section.label}>
                                    <div className="px-4 pb-1 pt-2.5 text-[10.5px] font-semibold uppercase tracking-[0.06em] text-[color:var(--c-text-dim)]">
                                        {section.label}
                                    </div>
                                    <ul>
                                        {section.items.map((n) => {
                                            const style = KIND_STYLE[n.kind] ?? FALLBACK_STYLE
                                            return (
                                                <li key={n.id} className="group relative">
                                                    <button
                                                        type="button"
                                                        onClick={() => openItem(n)}
                                                        tabIndex={open ? 0 : -1}
                                                        className="flex w-full items-start gap-3 px-4 py-2.5 text-left transition-colors hover:bg-[color:var(--c-overlay)]"
                                                    >
                                                        <MiniIcon tone={style.tone} size={30}>
                                                            {style.icon}
                                                        </MiniIcon>
                                                        <span className="min-w-0 flex-1">
                                                            <span className="block truncate text-[12.5px] font-semibold text-[color:var(--c-text)]">
                                                                {n.title}
                                                            </span>
                                                            <span className="block truncate text-[11.5px] text-[color:var(--c-text-muted)]">
                                                                {n.meta}
                                                            </span>
                                                        </span>
                                                        {/* Yields the corner to the dismiss button on hover — the
                                                            row is too tight to carry both, and the timestamp is the
                                                            less useful of the two once you're reaching for the X. */}
                                                        <span className="flex shrink-0 items-center gap-1.5 pt-0.5 transition-opacity group-hover:opacity-0">
                                                            <span className="text-[11px] tabular-nums text-[color:var(--c-text-dim)]">
                                                                {timeAgo(n.created_at)}
                                                            </span>
                                                            {n.read_at === null && (
                                                                <span className="h-1.5 w-1.5 rounded-full bg-[color:var(--c-primary)]" />
                                                            )}
                                                        </span>
                                                    </button>
                                                    {/* A SIBLING of the row button, not a child — nesting buttons is
                                                        invalid HTML and browsers resolve the click ambiguously. It
                                                        overlays the timestamp instead. */}
                                                    <button
                                                        type="button"
                                                        onClick={() => dismiss(n.id)}
                                                        tabIndex={open ? 0 : -1}
                                                        aria-label={`Dismiss "${n.title}"`}
                                                        className="absolute right-2.5 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-md text-[color:var(--c-text-dim)] opacity-0 transition-[opacity,color,background-color] hover:bg-[color:var(--c-surface-2)] hover:text-[color:var(--c-text)] focus-visible:opacity-100 group-hover:opacity-100"
                                                    >
                                                        <XIcon />
                                                    </button>
                                                </li>
                                            )
                                        })}
                                    </ul>
                                </div>
                            ))
                        )}
                    </div>
                </div>
            </m.div>
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
function RefreshIcon() {
    return (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M21 12a9 9 0 0 1-15.5 6.2L3 16M3 12a9 9 0 0 1 15.5-6.2L21 8" />
            <path d="M21 4v4h-4M3 20v-4h4" />
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
function XIcon() {
    return (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M18 6 6 18M6 6l12 12" />
        </svg>
    )
}
