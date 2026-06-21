import type { ReactNode } from "react"
import { MiniCard, type Tone } from "@/components/field-card"

type Tag = "trigger" | "action" | "output" | "info" | "rose" | "muted"

const TAG_TONE: Record<Tag, Tone> = {
    trigger: "amber",
    action:  "blue",
    output:  "emerald",
    info:    "violet",
    rose:    "rose",
    muted:   "zinc",
}

interface WorkflowCardProps {
    tag?: Tag
    tone?: Tone
    icon?: ReactNode
    title?: ReactNode
    subtitle?: ReactNode
    menu?: ReactNode
    footer?: ReactNode
    className?: string
    children?: ReactNode
    interactive?: boolean
}

// Thin compatibility wrapper over the shared <MiniCard> primitive. Older
// callers passed a CI-style status `tag`; that now just picks the tinted
// tone for the circular glyph. New callers should prefer MiniCard / a
// `tone` directly.
export function WorkflowCard({
    tag,
    tone,
    icon,
    title,
    subtitle,
    menu,
    footer,
    className,
    children,
    interactive = true,
}: WorkflowCardProps) {
    const resolvedTone: Tone = tone ?? (tag ? TAG_TONE[tag] : "zinc")
    return (
        <MiniCard
            tone={resolvedTone}
            icon={icon ?? <Dot />}
            title={title}
            subtitle={subtitle}
            menu={menu}
            footer={footer}
            className={className}
            interactive={interactive}
        >
            {children}
        </MiniCard>
    )
}

function Dot() {
    return (
        <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
            <circle cx="12" cy="12" r="4" />
        </svg>
    )
}

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
