"use client"

import { useEffect, useState, type FocusEvent, type MouseEvent, type ReactNode } from "react"
import { createPortal } from "react-dom"

// useHoverTooltip — small portal-rendered tooltip used on icon
// tiles. Returns event handlers to spread on the trigger element
// plus an `overlay` node to render alongside it.
//
// Why a portal: the icon grids live inside scroll containers
// (overflow-y-auto). An in-tree absolutely-positioned tooltip
// would clip at the container edge — rendering into document.body
// sidesteps that. The same trick the project's <Dropdown> uses.
//
// Why no ref: the bounding rect comes from `event.currentTarget`
// inside the onMouseEnter / onFocus handlers. That keeps the API
// to plain DOM event props and avoids the refs-during-render lint
// rule that fires when you pass a ref through a hook return.
export function useHoverTooltip(text: string): {
    triggerProps: {
        onMouseEnter: (e: MouseEvent<HTMLElement>) => void
        onMouseLeave: () => void
        onFocus: (e: FocusEvent<HTMLElement>) => void
        onBlur: () => void
    }
    overlay: ReactNode
} {
    const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
    const [portalReady, setPortalReady] = useState(false)

    // eslint-disable-next-line react-hooks/set-state-in-effect
    useEffect(() => { setPortalReady(true) }, [])

    // Hide on scroll/resize so a stale tooltip doesn't drift away
    // from its trigger.
    useEffect(() => {
        if (!pos) return
        function hide() { setPos(null) }
        window.addEventListener("scroll", hide, true)
        window.addEventListener("resize", hide)
        return () => {
            window.removeEventListener("scroll", hide, true)
            window.removeEventListener("resize", hide)
        }
    }, [pos])

    function showFrom(el: Element) {
        const r = el.getBoundingClientRect()
        setPos({ top: r.top - 6, left: r.left + r.width / 2 })
    }
    function hide() { setPos(null) }

    const overlay = portalReady && pos
        ? createPortal(
            <div
                className="pointer-events-none fixed z-[60] -translate-x-1/2 -translate-y-full rounded-md bg-zinc-900 px-2 py-1 text-[11px] font-medium text-white shadow-md whitespace-nowrap"
                style={{ top: pos.top, left: pos.left }}
            >
                {text}
            </div>,
            document.body,
        )
        : null

    return {
        triggerProps: {
            onMouseEnter: (e) => showFrom(e.currentTarget),
            onMouseLeave: hide,
            onFocus: (e) => showFrom(e.currentTarget),
            onBlur: hide,
        },
        overlay,
    }
}
