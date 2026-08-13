"use client"

import { useEffect, useSyncExternalStore } from "react"
import { cn } from "@/components/ui/cn"

// Appearance — light / dark / system.
//
// The stored value is the SOURCE OF TRUTH for the boot script in app/layout.tsx,
// so the contract is shared and narrow: `ucelot-theme` is "light", "dark", or
// absent. Absent means follow the OS — deliberately an absence rather than the
// string "system", because that is exactly what the boot script tests to decide
// whether it should keep listening for OS changes. Writing "system" would need
// both places to learn a third case for no gain.
//
// Applying the choice is a direct DOM write rather than React state: the
// attribute lives on <html>, above the React root, and every surface in the app
// already reads it through the cascade.

type Choice = "light" | "dark" | "system"

const OPTIONS: { value: Choice; label: string; hint: string }[] = [
    { value: "light", label: "Light", hint: "Always the cream desk" },
    { value: "dark", label: "Dark", hint: "Always midnight" },
    { value: "system", label: "System", hint: "Follow your device" },
]

function systemTheme(): "light" | "dark" {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"
}

// localStorage is an external store, so it is read through
// useSyncExternalStore rather than copied into state inside an effect. That
// avoids the cascading render the effect version causes (and which the lint
// rule flags), and gives the server a defined snapshot instead of a guess that
// has to be corrected after paint.
//
// The snapshot is memoised because useSyncExternalStore requires a value that
// is stable between calls while nothing has changed; `storage` only fires in
// OTHER tabs, so same-tab writes invalidate and notify by hand.
const listeners = new Set<() => void>()
let snapshot: Choice | null = null

function readChoice(): Choice {
    if (snapshot === null) {
        const v = localStorage.getItem("ucelot-theme")
        snapshot = v === "light" || v === "dark" ? v : "system"
    }
    return snapshot
}
function invalidate() {
    snapshot = null
    listeners.forEach((l) => l())
}
function subscribe(cb: () => void) {
    listeners.add(cb)
    window.addEventListener("storage", invalidate)
    return () => {
        listeners.delete(cb)
        window.removeEventListener("storage", invalidate)
    }
}

export function ThemePanel() {
    const choice = useSyncExternalStore(subscribe, readChoice, () => "system" as Choice)

    function apply(next: Choice) {
        if (next === "system") {
            localStorage.removeItem("ucelot-theme")
            document.documentElement.setAttribute("data-theme", systemTheme())
        } else {
            localStorage.setItem("ucelot-theme", next)
            document.documentElement.setAttribute("data-theme", next)
        }
        invalidate()
    }

    // While on "system", track the OS for the rest of this page view. The boot
    // script installs the same listener on load; this covers a switch to
    // "system" made after that ran, without a reload.
    useEffect(() => {
        if (choice !== "system") return
        const mq = window.matchMedia("(prefers-color-scheme: dark)")
        const onChange = (e: MediaQueryListEvent) => {
            document.documentElement.setAttribute("data-theme", e.matches ? "dark" : "light")
        }
        mq.addEventListener("change", onChange)
        return () => mq.removeEventListener("change", onChange)
    }, [choice])

    return (
        <div className="grid gap-2.5 sm:grid-cols-3" role="radiogroup" aria-label="Theme">
            {OPTIONS.map((o) => {
                const active = choice === o.value
                return (
                    <button
                        key={o.value}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        onClick={() => apply(o.value)}
                        className={cn(
                            "card card-hover flex flex-col items-start gap-2.5 text-left",
                            active && "border-[color:var(--c-primary)]",
                        )}
                    >
                        {/* A miniature of the shell — tinted desk, floating panel,
                            a hairline row — painted in the tokens that choice
                            resolves to. Named colours rather than the live tokens
                            on purpose: two of these three previews always depict a
                            theme the page is NOT currently in. */}
                        <Swatch value={o.value} />
                        <span className="flex w-full items-center gap-1.5">
                            <span className="text-[13px] font-bold">{o.label}</span>
                            {active && (
                                <svg
                                    className="ml-auto text-[color:var(--c-primary)]"
                                    width="14"
                                    height="14"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    aria-hidden
                                >
                                    <path
                                        d="M20 6L9 17l-5-5"
                                        stroke="currentColor"
                                        strokeWidth="2.6"
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                    />
                                </svg>
                            )}
                        </span>
                        <span className="text-[11.5px] leading-4 text-[color:var(--c-text-muted)]">
                            {o.hint}
                        </span>
                    </button>
                )
            })}
        </div>
    )
}

const LIGHT = { shell: "#f1efec", surface: "#ffffff", line: "#ececef", text: "#1f2430" }
const DARK = { shell: "#090c1c", surface: "#101630", line: "#22284a", text: "#eceff8" }

function Swatch({ value }: { value: Choice }) {
    if (value === "system") {
        // Split down the middle: the left half light, the right half dark, so
        // "follow your device" is legible as a picture rather than a label.
        return (
            <span className="relative block h-14 w-full overflow-hidden rounded-[9px] border border-[color:var(--c-border)]">
                <span className="absolute inset-y-0 left-0 w-1/2 overflow-hidden">
                    <Mini t={LIGHT} />
                </span>
                <span className="absolute inset-y-0 right-0 w-1/2 overflow-hidden">
                    <span className="absolute inset-y-0 left-[-100%] w-[200%]">
                        <Mini t={DARK} />
                    </span>
                </span>
            </span>
        )
    }
    return (
        <span className="relative block h-14 w-full overflow-hidden rounded-[9px] border border-[color:var(--c-border)]">
            <Mini t={value === "dark" ? DARK : LIGHT} />
        </span>
    )
}

function Mini({ t }: { t: typeof LIGHT }) {
    return (
        <span className="absolute inset-0 flex gap-1 p-1.5" style={{ background: t.shell }}>
            <span className="flex w-1/4 flex-col gap-1">
                <span className="h-1.5 rounded-[2px]" style={{ background: t.line }} />
                <span className="h-1.5 w-3/4 rounded-[2px]" style={{ background: t.line }} />
            </span>
            <span
                className="flex-1 rounded-[5px] p-1.5"
                style={{ background: t.surface, boxShadow: `0 0 0 1px ${t.line}` }}
            >
                <span className="block h-1.5 w-2/3 rounded-[2px]" style={{ background: t.text, opacity: 0.75 }} />
                <span className="mt-1 block h-1.5 w-1/2 rounded-[2px]" style={{ background: t.line }} />
            </span>
        </span>
    )
}
