import type { ReactNode } from "react"
import { cn } from "@/components/cn"

type Tag = "trigger" | "action" | "output" | "info" | "rose"

interface WorkflowCardProps {
    tag?: Tag
    tagLabel?: string
    icon?: ReactNode
    title?: ReactNode
    menu?: ReactNode
    footer?: ReactNode
    className?: string
    children?: ReactNode
    interactive?: boolean
}

// Reusable card primitive matching ci/components.html. Composes the tag,
// title row, body, and footer slots so individual screens can drop in
// content without re-implementing the chrome.
export function WorkflowCard({
    tag,
    tagLabel,
    icon,
    title,
    menu,
    footer,
    className,
    children,
    interactive = true,
}: WorkflowCardProps) {
    const tagClass = tag ? `card-tag-${tag}` : ""
    return (
        <div className={cn("card", interactive && "card-hover", className)}>
            {tag && (
                <span className={cn("card-tag", tagClass)}>
                    <BoltDot />
                    {tagLabel ?? defaultTagLabel(tag)}
                </span>
            )}
            {title && (
                <div className="card-title">
                    {icon && <span className="grid h-[18px] w-[18px] shrink-0 place-items-center text-[color:var(--c-text)]">{icon}</span>}
                    <span className="min-w-0 truncate">{title}</span>
                    {menu ?? <DefaultMenuButton />}
                </div>
            )}
            {children && <div className="mt-2.5 flex flex-col gap-2">{children}</div>}
            {footer && <div className="card-footer">{footer}</div>}
        </div>
    )
}

function defaultTagLabel(t: Tag) {
    return t.charAt(0).toUpperCase() + t.slice(1)
}

function BoltDot() {
    return (
        <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
            <circle cx="12" cy="12" r="4" />
        </svg>
    )
}

function DefaultMenuButton() {
    return (
        <button type="button" className="card-menu-btn" aria-label="More">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                <circle cx="6" cy="12" r="1.6" />
                <circle cx="12" cy="12" r="1.6" />
                <circle cx="18" cy="12" r="1.6" />
            </svg>
        </button>
    )
}

// Footer helpers — small inline components used inside card footer slots.
export function FooterMeta({ children }: { children: ReactNode }) {
    return <span className="inline-flex items-center gap-1">{children}</span>
}

export function FooterClock({ label }: { label: string }) {
    return (
        <FooterMeta>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                <circle cx="12" cy="12" r="9" />
                <path d="M12 7v5l3 2" />
            </svg>
            {label}
        </FooterMeta>
    )
}

export function FooterAlert({ children }: { children: ReactNode }) {
    return (
        <span className="ml-auto inline-flex items-center gap-1 font-semibold text-[color:var(--c-error)]">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                <circle cx="12" cy="12" r="9" />
                <path d="M12 8v5M12 16h0" />
            </svg>
            {children}
        </span>
    )
}
