"use client"

import {
    useEffect,
    useId,
    useMemo,
    useRef,
    useState,
    type ReactNode,
} from "react"
import { createPortal } from "react-dom"
import { cn } from "@/components/cn"

export interface MultiDropdownOption<V extends string = string> {
    value: V
    label: string
    description?: string
    icon?: ReactNode
    group?: string
}

interface MultiDropdownProps<V extends string = string> {
    values: V[]
    onChange: (v: V[]) => void
    options: MultiDropdownOption<V>[]
    placeholder?: string
    leadingIcon?: ReactNode
    searchable?: boolean
    className?: string
    triggerClassName?: string
    disabled?: boolean
    "aria-label"?: string
    /** Optional max count of selections shown in the trigger label
     *  before collapsing to "N selected". Default 2. */
    maxLabelCount?: number
}

// Multi-select sibling of <Dropdown>. Same visual language: rounded
// trigger, panel popover, optional search box, keyboard nav. The
// difference is that clicking an option toggles it instead of
// committing — the panel stays open so the user can pick several in
// a row. Trigger renders a count chip when more than one is picked.
export function MultiDropdown<V extends string = string>({
    values,
    onChange,
    options,
    placeholder = "Select…",
    leadingIcon,
    searchable = false,
    className,
    triggerClassName,
    disabled,
    "aria-label": ariaLabel,
    maxLabelCount = 2,
}: MultiDropdownProps<V>) {
    const [open, setOpen] = useState(false)
    const [query, setQuery] = useState("")
    const [activeIdx, setActiveIdx] = useState<number>(-1)
    const rootRef = useRef<HTMLDivElement>(null)
    const panelRef = useRef<HTMLDivElement>(null)
    const searchRef = useRef<HTMLInputElement>(null)
    const triggerRef = useRef<HTMLButtonElement>(null)
    const listboxId = useId()
    // Portal target — mirrors components/dropdown.tsx. We render the
    // listbox panel into document.body so it escapes any
    // overflow:hidden ancestor (notably <Modal>'s rounded card).
    const [portalReady, setPortalReady] = useState(false)
    // eslint-disable-next-line react-hooks/set-state-in-effect
    useEffect(() => { setPortalReady(true) }, [])
    const [panelPos, setPanelPos] = useState({ top: 0, left: 0, width: 0 })

    const filtered = useMemo(() => {
        if (!query.trim()) return options
        const q = query.toLowerCase()
        return options.filter(
            (o) =>
                o.label.toLowerCase().includes(q) ||
                (o.description ?? "").toLowerCase().includes(q),
        )
    }, [options, query])

    const grouped = useMemo(() => {
        const map = new Map<string | undefined, MultiDropdownOption<V>[]>()
        for (const o of filtered) {
            const arr = map.get(o.group) ?? []
            arr.push(o)
            map.set(o.group, arr)
        }
        return Array.from(map.entries())
    }, [filtered])

    const valueSet = useMemo(() => new Set(values), [values])
    const selectedOptions = useMemo(
        () => options.filter((o) => valueSet.has(o.value)),
        [options, valueSet],
    )

    useEffect(() => {
        if (!open) return
        function onClick(e: MouseEvent) {
            // Click-outside has to consider the portal panel since
            // it lives in document.body, outside of rootRef's tree.
            const target = e.target as Node
            if (rootRef.current?.contains(target)) return
            if (panelRef.current?.contains(target)) return
            close()
        }
        document.addEventListener("mousedown", onClick)
        return () => document.removeEventListener("mousedown", onClick)
    }, [open])

    // Track trigger geometry so the portal panel sits exactly under
    // the trigger and follows it on scroll / resize.
    useEffect(() => {
        if (!open) return
        function update() {
            const r = triggerRef.current?.getBoundingClientRect()
            if (!r) return
            setPanelPos({ top: r.bottom + 6, left: r.left, width: r.width })
        }
        update()
        window.addEventListener("scroll", update, true)
        window.addEventListener("resize", update)
        return () => {
            window.removeEventListener("scroll", update, true)
            window.removeEventListener("resize", update)
        }
    }, [open])

    function openIt() {
        setOpen(true)
        setActiveIdx(0)
        if (searchable) requestAnimationFrame(() => searchRef.current?.focus())
    }
    function close() {
        setOpen(false)
        setQuery("")
        setActiveIdx(-1)
    }

    function toggle(v: V) {
        if (valueSet.has(v)) onChange(values.filter((x) => x !== v))
        else onChange([...values, v])
    }

    function onKeyDown(e: React.KeyboardEvent) {
        if (!open) {
            if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
                e.preventDefault()
                openIt()
            }
            return
        }
        if (e.key === "Escape") {
            e.preventDefault()
            close()
            triggerRef.current?.focus()
        } else if (e.key === "ArrowDown") {
            e.preventDefault()
            setActiveIdx((i) => (i + 1) % filtered.length)
        } else if (e.key === "ArrowUp") {
            e.preventDefault()
            setActiveIdx((i) => (i - 1 + filtered.length) % filtered.length)
        } else if (e.key === "Enter") {
            e.preventDefault()
            const opt = filtered[activeIdx] ?? filtered[0]
            if (opt) toggle(opt.value)
        }
    }

    const triggerLabel = (() => {
        if (selectedOptions.length === 0) return placeholder
        if (selectedOptions.length <= maxLabelCount) {
            return selectedOptions.map((o) => o.label).join(", ")
        }
        return `${selectedOptions.length} selected`
    })()

    return (
        <div
            ref={rootRef}
            className={cn("relative inline-block w-full", className)}
            data-open={open ? "true" : "false"}
            onKeyDown={onKeyDown}
        >
            <button
                ref={triggerRef}
                type="button"
                disabled={disabled}
                aria-haspopup="listbox"
                aria-expanded={open}
                aria-controls={listboxId}
                aria-label={ariaLabel}
                onClick={() => {
                    if (disabled) return
                    if (open) close()
                    else openIt()
                }}
                className={cn(
                    "inline-flex w-full items-center gap-2 rounded-[12px] border bg-white px-3 py-[9px] text-[13px]",
                    "font-medium text-[color:var(--c-text)] text-left transition-[border-color,box-shadow,background] duration-[140ms]",
                    "hover:border-[color:var(--c-border-strong)] disabled:cursor-not-allowed disabled:opacity-60",
                    open
                        ? "border-zinc-900 ring-[3px] ring-zinc-900/8"
                        : "border-[color:var(--c-border)]",
                    triggerClassName,
                )}
            >
                {leadingIcon && (
                    <span className="grid h-4 w-4 shrink-0 place-items-center text-[color:var(--c-text-muted)]">
                        {leadingIcon}
                    </span>
                )}
                <span
                    className={cn(
                        "flex-1 min-w-0 truncate",
                        selectedOptions.length === 0 && "text-[color:var(--c-text-dim)]",
                    )}
                >
                    {triggerLabel}
                </span>
                {selectedOptions.length > 0 && (
                    <span className="rounded-full bg-zinc-900 px-1.5 py-[1px] text-[10.5px] font-bold text-white tabular-nums">
                        {selectedOptions.length}
                    </span>
                )}
                <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    className={cn(
                        "shrink-0 text-[color:var(--c-text-dim)] transition-transform duration-[140ms]",
                        open && "rotate-180",
                    )}
                    aria-hidden
                >
                    <path d="M6 9l6 6 6-6" />
                </svg>
            </button>

            {portalReady && open && createPortal(
                <div
                    ref={panelRef}
                    id={listboxId}
                    role="listbox"
                    aria-multiselectable
                    style={{
                        position: "fixed",
                        top: panelPos.top,
                        left: panelPos.left,
                        width: panelPos.width,
                        zIndex: 60,
                    }}
                    className={cn(
                        "max-h-80 overflow-auto rounded-[12px] border bg-white p-1.5 shadow-[var(--shadow-pop)]",
                        "border-[color:var(--c-border)]",
                        "anim-rise",
                    )}
                >
                {searchable && (
                    <div className="-mx-1.5 -mt-1.5 mb-1 flex items-center gap-2 border-b border-[color:var(--c-border)] px-2.5 pb-1.5 pt-2">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-[color:var(--c-text-dim)]" aria-hidden>
                            <circle cx="11" cy="11" r="7" />
                            <path d="M21 21l-4-4" />
                        </svg>
                        <input
                            ref={searchRef}
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === "Escape") {
                                    e.preventDefault()
                                    close()
                                    triggerRef.current?.focus()
                                }
                            }}
                            placeholder="Search…"
                            className="w-full bg-transparent text-[13px] text-[color:var(--c-text)] outline-none placeholder:text-[color:var(--c-text-dim)]"
                        />
                    </div>
                )}

                {filtered.length === 0 && (
                    <div className="px-3 py-5 text-center text-[12.5px] text-[color:var(--c-text-dim)]">
                        No matches.
                    </div>
                )}

                {grouped.map(([group, opts], gi) => (
                    <div key={group ?? `__nogroup_${gi}`}>
                        {group && (
                            <div className="px-2.5 pb-1 pt-2 text-[10.5px] font-bold uppercase tracking-[0.08em] text-[color:var(--c-text-dim)]">
                                {group}
                            </div>
                        )}
                        {opts.map((o) => {
                            const idxInFlat = filtered.indexOf(o)
                            const isActive = idxInFlat === activeIdx
                            const isSelected = valueSet.has(o.value)
                            return (
                                <button
                                    key={o.value}
                                    type="button"
                                    role="option"
                                    aria-selected={isSelected}
                                    onMouseEnter={() => setActiveIdx(idxInFlat)}
                                    onClick={() => toggle(o.value)}
                                    className={cn(
                                        "flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] text-left transition-colors duration-[140ms]",
                                        isActive && "bg-[color:var(--c-overlay)]",
                                        isSelected && "bg-indigo-50/70",
                                    )}
                                >
                                    <span
                                        aria-hidden
                                        className={cn(
                                            "grid h-4 w-4 shrink-0 place-items-center rounded-[5px] border transition-colors",
                                            isSelected
                                                ? "border-zinc-900 bg-zinc-900 text-white"
                                                : "border-[color:var(--c-border-strong)] bg-white",
                                        )}
                                    >
                                        {isSelected && (
                                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round">
                                                <path d="M5 12l5 5L20 7" />
                                            </svg>
                                        )}
                                    </span>
                                    {o.icon && (
                                        <span className="grid h-[18px] w-[18px] shrink-0 place-items-center rounded-[5px] text-[color:var(--c-text-muted)]">
                                            {o.icon}
                                        </span>
                                    )}
                                    <span className="flex min-w-0 flex-1 flex-col">
                                        <span className="truncate text-[13px] font-semibold leading-tight">
                                            {o.label}
                                        </span>
                                        {o.description && (
                                            <span className="truncate text-[11.5px] leading-snug text-[color:var(--c-text-muted)]">
                                                {o.description}
                                            </span>
                                        )}
                                    </span>
                                </button>
                            )
                        })}
                    </div>
                ))}
                </div>,
                document.body,
            )}
        </div>
    )
}
