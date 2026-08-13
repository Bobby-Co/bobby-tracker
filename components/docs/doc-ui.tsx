// Presentational building blocks for documentation pages. All server-safe (no
// hooks) so pages can stay server components. They lean on the shared design
// tokens + .prose-tracker rules in globals.css, with a warm ember accent that
// nods to the Ucelot brand.

import Link from "next/link"
import type { ReactNode } from "react"
import { DOC_PAGES } from "@/components/docs/nav"

/** Page title block. `eyebrow` is the small uppercase kicker above the title. */
export function DocHeader({
    eyebrow,
    title,
    lead,
}: {
    eyebrow?: string
    title: string
    lead?: ReactNode
}) {
    return (
        <header className="mb-8 anim-rise">
            {eyebrow && (
                <div className="mb-2 text-[11px] font-bold uppercase tracking-[0.14em] text-amber-700">
                    {eyebrow}
                </div>
            )}
            <h1 className="text-[30px] font-extrabold leading-tight tracking-[-0.02em] text-[color:var(--c-text)]">
                {title}
            </h1>
            {lead && (
                <p className="mt-3 max-w-2xl text-[15.5px] leading-7 text-[color:var(--c-text-muted)]">
                    {lead}
                </p>
            )}
        </header>
    )
}

/** A titled content section with a stable anchor id for deep-linking. */
export function DocSection({
    id,
    title,
    children,
}: {
    id?: string
    title?: string
    children: ReactNode
}) {
    return (
        <section id={id} className="mt-10 scroll-mt-24">
            {title && (
                <h2 className="mb-3 text-[19px] font-bold tracking-[-0.01em] text-[color:var(--c-text)]">
                    {title}
                </h2>
            )}
            <div className="prose-tracker max-w-2xl">{children}</div>
        </section>
    )
}

const CALLOUT_TONE = {
    info: "border-[color:var(--c-info-fg)]/20 bg-[color:var(--c-info-bg)] text-[color:var(--c-info-fg)]",
    warn: "border-[color:var(--c-warn)]/20 bg-[color:var(--c-warn-bg)] text-[color:var(--c-warn)]",
    success: "border-[color:var(--c-success)]/20 bg-[color:var(--c-success-bg)] text-[color:var(--c-success)]",
    ember: "border-amber-500/25 bg-amber-50 text-amber-900",
} as const

/** Highlighted aside — a tinted, bordered block for tips / key facts. */
export function Callout({
    tone = "info",
    title,
    children,
}: {
    tone?: keyof typeof CALLOUT_TONE
    title?: string
    children: ReactNode
}) {
    return (
        <div className={`my-5 rounded-[14px] border px-4 py-3.5 ${CALLOUT_TONE[tone]}`}>
            {title && <div className="mb-1 text-[13px] font-bold">{title}</div>}
            <div className="text-[13.5px] leading-6 [&_p]:my-1 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0">
                {children}
            </div>
        </div>
    )
}

/** Placeholder for a section that's planned but not written yet. */
export function ComingSoon({ children }: { children?: ReactNode }) {
    return (
        <div className="my-5 flex items-start gap-3 rounded-[14px] border border-dashed border-[color:var(--c-border-strong)] bg-[color:var(--c-surface-2)] px-4 py-4 text-[13.5px] text-[color:var(--c-text-muted)]">
            <span className="mt-[1px] inline-flex shrink-0 items-center rounded-full bg-[color:var(--c-overlay)] px-2 py-[2px] text-[10.5px] font-bold uppercase tracking-wide text-[color:var(--c-text-dim)]">
                Soon
            </span>
            <p className="leading-6">
                {children ?? "This section is on the way. Check back shortly."}
            </p>
        </div>
    )
}

/** Ordered how-to steps. Wrap <Step> children. */
export function Steps({ children }: { children: ReactNode }) {
    return <ol className="my-5 space-y-4 [counter-reset:step] list-none pl-0">{children}</ol>
}

export function Step({ title, children }: { title: string; children?: ReactNode }) {
    return (
        <li className="relative pl-11 [counter-increment:step]">
            <span
                className="absolute left-0 top-0 grid h-7 w-7 place-items-center rounded-full bg-[var(--c-secondary)] text-[13px] font-bold text-white
                    before:content-[counter(step)]"
            />
            <div className="text-[14.5px] font-bold text-[color:var(--c-text)]">{title}</div>
            {children && (
                <div className="mt-1 text-[13.5px] leading-6 text-[color:var(--c-text-muted)] [&_p]:my-1 [&_p:first-child]:mt-0">
                    {children}
                </div>
            )}
        </li>
    )
}

/** Small labelled feature card used in grids on the overview. */
export function FeatureCard({
    icon,
    title,
    children,
    href,
}: {
    icon?: ReactNode
    title: string
    children: ReactNode
    href?: string
}) {
    const inner = (
        <div className="card card-hover h-full">
            {icon && (
                <div className="mb-3 grid h-9 w-9 place-items-center rounded-[10px] bg-amber-50 text-amber-700">
                    {icon}
                </div>
            )}
            <div className="text-[15px] font-bold tracking-[-0.01em] text-[color:var(--c-text)]">
                {title}
            </div>
            <p className="mt-1.5 text-[13px] leading-6 text-[color:var(--c-text-muted)]">{children}</p>
            {href && (
                <div className="mt-3 inline-flex items-center gap-1 text-[12.5px] font-semibold text-amber-700">
                    Read more
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden>
                        <path d="M5 12h14M13 6l6 6-6 6" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                </div>
            )}
        </div>
    )
    return href ? (
        <Link href={href} className="block">
            {inner}
        </Link>
    ) : (
        inner
    )
}

/** Prev / next pager derived from DOC_PAGES ordering. */
export function DocPager({ current }: { current: string }) {
    const idx = DOC_PAGES.findIndex((p) => p.href === current)
    if (idx === -1) return null
    const prev = DOC_PAGES[idx - 1]
    const next = DOC_PAGES[idx + 1]
    if (!prev && !next) return null
    return (
        <nav className="mt-14 flex items-stretch justify-between gap-3 border-t border-[color:var(--c-border)] pt-6">
            {prev ? (
                <Link href={prev.href} className="btn-ghost !py-2.5 text-left">
                    <span className="mr-1 text-[color:var(--c-text-dim)]">←</span>
                    {prev.label}
                </Link>
            ) : (
                <span />
            )}
            {next ? (
                <Link href={next.href} className="btn-primary !py-2.5">
                    {next.label}
                    <span className="ml-1 opacity-70">→</span>
                </Link>
            ) : (
                <span />
            )}
        </nav>
    )
}
