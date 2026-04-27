"use client"

import {
    useEffect,
    useId,
    useMemo,
    useRef,
    useState,
    type ReactNode,
} from "react"
import { cn } from "@/components/cn"

export interface DropdownOption<V extends string = string> {
    value: V
    label: string
    description?: string
    icon?: ReactNode      // small left-side icon (18×18 box)
    group?: string        // optional grouping; rendered as a section header
}

interface DropdownProps<V extends string = string> {
    value: V
    onChange: (v: V) => void
    options: DropdownOption<V>[]
    placeholder?: string
    leadingIcon?: ReactNode
    tag?: string             // small right-side tag inside the trigger ("live", "default")
    searchable?: boolean
    className?: string
    triggerClassName?: string
    disabled?: boolean
    "aria-label"?: string
}

// Custom combobox modelled after ci/components.html. Single-select; supports
// optional search, grouped options, keyboard nav (↑ ↓ Enter Esc),
// click-outside-to-close, and a chevron that rotates when open.
//
// Usage:
//   <Dropdown
//     value={status} onChange={setStatus}
//     options={[{value:"open", label:"Open"}, ...]}
//     leadingIcon={<DotIcon className="h-4 w-4" />}
//   />
export function Dropdown<V extends string = string>({
    value,
    onChange,
    options,
    placeholder = "Select…",
    leadingIcon,
    tag,
    searchable = false,
    className,
    triggerClassName,
    disabled,
    "aria-label": ariaLabel,
}: DropdownProps<V>) {
    const [open, setOpen] = useState(false)
    const [query, setQuery] = useState("")
    const [activeIdx, setActiveIdx] = useState<number>(-1)
    const rootRef = useRef<HTMLDivElement>(null)
    const searchRef = useRef<HTMLInputElement>(null)
    const triggerRef = useRef<HTMLButtonElement>(null)
    const listboxId = useId()

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
        const map = new Map<string | undefined, DropdownOption<V>[]>()
        for (const o of filtered) {
            const arr = map.get(o.group) ?? []
            arr.push(o)
            map.set(o.group, arr)
        }
        return Array.from(map.entries())
    }, [filtered])

    const flatOptions = filtered

    const selected = options.find((o) => o.value === value) ?? null

    useEffect(() => {
        if (!open) return
        function onClick(e: MouseEvent) {
            if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
                close()
            }
        }
        document.addEventListener("mousedown", onClick)
        return () => document.removeEventListener("mousedown", onClick)
    }, [open])

    function openIt() {
        setOpen(true)
        setActiveIdx(options.findIndex((o) => o.value === value))
        if (searchable) requestAnimationFrame(() => searchRef.current?.focus())
    }
    function close() {
        setOpen(false)
        setQuery("")
        setActiveIdx(-1)
    }

    function commit(v: V) {
        onChange(v)
        close()
        triggerRef.current?.focus()
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
            setActiveIdx((i) => (i + 1) % flatOptions.length)
        } else if (e.key === "ArrowUp") {
            e.preventDefault()
            setActiveIdx((i) => (i - 1 + flatOptions.length) % flatOptions.length)
        } else if (e.key === "Enter") {
            e.preventDefault()
            const opt = flatOptions[activeIdx] ?? flatOptions[0]
            if (opt) commit(opt.value)
        }
    }

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
                        !selected && "text-[color:var(--c-text-dim)]",
                    )}
                >
                    {selected ? selected.label : placeholder}
                </span>
                {tag && (
                    <span className="rounded-full bg-[color:var(--c-overlay)] px-1.5 py-[2px] text-[10.5px] font-semibold text-[color:var(--c-text-muted)]">
                        {tag}
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

            <div
                id={listboxId}
                role="listbox"
                className={cn(
                    "absolute left-0 right-0 z-30 mt-1.5 max-h-80 overflow-auto rounded-[12px] border bg-white p-1.5 shadow-[var(--shadow-pop)]",
                    "border-[color:var(--c-border)]",
                    "transition-[opacity,transform] duration-[140ms]",
                    open
                        ? "pointer-events-auto opacity-100 translate-y-0 scale-100"
                        : "pointer-events-none opacity-0 -translate-y-1 scale-[0.98]",
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
                            const idxInFlat = flatOptions.indexOf(o)
                            const isActive = idxInFlat === activeIdx
                            const isSelected = o.value === value
                            return (
                                <button
                                    key={o.value}
                                    type="button"
                                    role="option"
                                    aria-selected={isSelected}
                                    onMouseEnter={() => setActiveIdx(idxInFlat)}
                                    onClick={() => commit(o.value)}
                                    className={cn(
                                        "flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] text-left transition-colors duration-[140ms]",
                                        isActive && "bg-[color:var(--c-overlay)]",
                                        isSelected && "bg-indigo-50/70",
                                    )}
                                >
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
                                    <svg
                                        width="14"
                                        height="14"
                                        viewBox="0 0 24 24"
                                        fill="none"
                                        stroke="currentColor"
                                        strokeWidth="3"
                                        className={cn(
                                            "shrink-0 text-[color:var(--c-accent)] transition-opacity duration-[140ms]",
                                            isSelected ? "opacity-100" : "opacity-0",
                                        )}
                                        aria-hidden
                                    >
                                        <path d="M5 12l5 5L20 6" />
                                    </svg>
                                </button>
                            )
                        })}
                    </div>
                ))}
            </div>
        </div>
    )
}
