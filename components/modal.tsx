"use client"

import { useEffect, useRef, type ReactNode } from "react"
import { cn } from "@/components/cn"

interface ModalProps {
    open: boolean
    onClose: () => void
    title?: string
    description?: string
    children: ReactNode
    /** Max width preset. Defaults to "md" (28rem). */
    size?: "sm" | "md" | "lg"
}

const SIZES: Record<NonNullable<ModalProps["size"]>, string> = {
    sm: "max-w-sm",
    md: "max-w-md",
    lg: "max-w-2xl",
}

// Lightweight modal — backdrop + centered card. Uses Esc to close,
// click-outside-card to close, and locks body scroll while open. Renders
// nothing when closed so we don't leak DOM. Pair with a button that owns
// the open state.
export function Modal({ open, onClose, title, description, children, size = "md" }: ModalProps) {
    const cardRef = useRef<HTMLDivElement>(null)
    // Latest onClose without retriggering the effect. Callers usually
    // pass an inline arrow (`onClose={() => setOpen(false)}`), which
    // otherwise re-runs the effect on every parent render — that would
    // move focus back to the close button and re-lock body scroll on
    // every keystroke inside the modal.
    const onCloseRef = useRef(onClose)
    useEffect(() => { onCloseRef.current = onClose }, [onClose])

    useEffect(() => {
        if (!open) return
        function onKey(e: KeyboardEvent) {
            if (e.key === "Escape") onCloseRef.current()
        }
        document.addEventListener("keydown", onKey)
        const prev = document.body.style.overflow
        document.body.style.overflow = "hidden"
        // Focus the first non-close focusable inside the card. We
        // skip the X button so opening doesn't immediately preview
        // a focus ring on Close, and so we can put focus on whatever
        // input the form actually wants the user to start with.
        requestAnimationFrame(() => {
            const focusables = cardRef.current?.querySelectorAll<HTMLElement>(
                "input, textarea, select, button, [tabindex]:not([tabindex='-1'])",
            )
            const target = Array.from(focusables ?? []).find(
                (el) => el.getAttribute("aria-label") !== "Close",
            )
            target?.focus()
        })
        return () => {
            document.removeEventListener("keydown", onKey)
            document.body.style.overflow = prev
        }
    }, [open])

    if (!open) return null

    return (
        <div
            role="dialog"
            aria-modal="true"
            aria-label={title}
            className="fixed inset-0 z-50 flex items-center justify-center px-4 anim-fade"
        >
            {/* backdrop */}
            <button
                type="button"
                aria-label="Close"
                onClick={onClose}
                className="absolute inset-0 cursor-default bg-zinc-950/35 backdrop-blur-[2px]"
            />

            {/*
                card. NO overflow-hidden here — that used to clip
                dropdown / popover panels rendered inside the modal
                body (Dropdown, MultiDropdown, etc.) the moment they
                tried to extend past the card's bottom edge. Header
                gets its own rounded-top now so the surface-2 fill
                still tucks under the card's rounded corners
                without needing the parent to clip.
            */}
            <div
                ref={cardRef}
                onClick={(e) => e.stopPropagation()}
                className={cn(
                    "relative anim-rise w-full rounded-[18px] border border-[color:var(--c-border)] bg-white shadow-[var(--shadow-pop)]",
                    SIZES[size],
                )}
            >
                {(title || description) && (
                    <header className="flex items-start justify-between gap-4 rounded-t-[18px] border-b border-[color:var(--c-border)] bg-[color:var(--c-surface-2)] px-5 py-4">
                        <div className="min-w-0">
                            {title && <h2 className="text-[16px] font-bold tracking-[-0.005em]">{title}</h2>}
                            {description && (
                                <p className="mt-0.5 text-[12.5px] text-[color:var(--c-text-muted)]">{description}</p>
                            )}
                        </div>
                        <button
                            type="button"
                            onClick={onClose}
                            aria-label="Close"
                            className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-[color:var(--c-text-dim)] transition-colors hover:bg-[color:var(--c-overlay)] hover:text-[color:var(--c-text)]"
                        >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
                                <path d="M6 6l12 12M18 6L6 18" />
                            </svg>
                        </button>
                    </header>
                )}
                <div className="px-5 py-5">{children}</div>
            </div>
        </div>
    )
}
