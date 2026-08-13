"use client"

import { useEffect, useRef, useState } from "react"

// Reveals its children once they scroll into view, and stays revealed. Used to
// tell the landing's manifesto a line at a time: each beat rises as it enters,
// so the reader takes the argument in steps instead of meeting it as a block.
//
// Deliberately IntersectionObserver rather than a scroll-driven CSS animation
// (`animation-timeline: view()`), which Safari doesn't support — this section is
// the page's argument, so it can't be a Chrome-only effect.

export default function Reveal({
    children,
    /** Stagger within a single beat, ms. */
    delay = 0,
    className = "",
}: {
    children: React.ReactNode
    delay?: number
    className?: string
}) {
    const ref = useRef<HTMLDivElement>(null)
    const [shown, setShown] = useState(false)

    useEffect(() => {
        const el = ref.current
        if (!el) return

        // No observer (or reduced motion): reveal immediately with no travel.
        // Written straight to the node rather than through state — setting state
        // synchronously inside an effect is both a wasted render and a lint
        // error (react-hooks/set-state-in-effect).
        const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
        if (typeof IntersectionObserver === "undefined" || reduce) {
            el.style.transition = "none"
            el.style.transform = "none"
            el.style.opacity = "1"
            return
        }

        const io = new IntersectionObserver(
            ([entry]) => {
                if (!entry.isIntersecting) return
                setShown(true)
                io.disconnect()
            },
            // Fire once the line is properly inside the viewport, not the moment
            // its first pixel clips the edge — the beat should land, not creep.
            { rootMargin: "-15% 0px -20% 0px" },
        )
        io.observe(el)
        return () => io.disconnect()
    }, [])

    return (
        <div
            ref={ref}
            className={className}
            style={{
                opacity: shown ? 1 : 0,
                transform: shown ? "none" : "translateY(22px)",
                transition:
                    "opacity 760ms cubic-bezier(0.22, 1, 0.36, 1), transform 760ms cubic-bezier(0.22, 1, 0.36, 1)",
                transitionDelay: `${delay}ms`,
            }}
        >
            {children}
        </div>
    )
}
