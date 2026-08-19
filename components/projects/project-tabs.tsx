"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { cn } from "@/components/ui/cn"

// Project tab bar. Six tabs don't fit a phone at full label width, so the
// labels are the thing that gives: on mobile a tab is its icon alone, and only
// the ACTIVE tab keeps its (short) label beside the icon — enough to answer
// "where am I?" without paying for five labels you aren't reading. From `sm`
// up every label is back and the row reads as a normal tab strip.
//
// The strip still scrolls horizontally as a backstop (a 320px screen, or a
// seventh tab later) — scrollbar hidden, since the icons themselves are the
// affordance.
export function ProjectTabs({ projectId }: { projectId: string }) {
    const pathname = usePathname()
    const tabs = [
        { href: `/projects/${projectId}/issues`, label: "Issues", icon: <IssuesIcon /> },
        // `short` is the mobile label for the active tab, where the row is
        // tightest; the full label is what shows from `sm` up.
        { href: `/projects/${projectId}/pulls`, label: "Pull requests", short: "Pulls", icon: <PullsIcon /> },
        { href: `/projects/${projectId}/mind`, label: "Mind", icon: <MindIcon /> },
        // Label only — the /knowledge path is unchanged, so existing links and
        // bookmarks keep working. Renaming the route would be a redirect to
        // maintain forever in exchange for a tidier URL nobody reads.
        { href: `/projects/${projectId}/knowledge`, label: "Intelligence", icon: <IntelligenceIcon /> },
        { href: `/projects/${projectId}/integrations`, label: "Integrations", icon: <IntegrationsIcon /> },
        { href: `/projects/${projectId}/settings`, label: "Settings", icon: <SettingsIcon /> },
    ]
    return (
        <div className="mt-4 -mx-1 flex gap-1 overflow-x-auto px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {tabs.map((t) => {
                const active = pathname === t.href || pathname.startsWith(t.href + "/")
                return (
                    <Link
                        key={t.href}
                        href={t.href}
                        // No eager prefetch: these pages fetch their own data
                        // client-side, so prefetching only buys the RSC shell
                        // while spinning up an extra Worker invocation (cold
                        // isolate) per tab on every project page. That fan-out
                        // is what amplifies the cold-start CPU storm.
                        prefetch={false}
                        // Icon-only tabs carry no text for a screen reader, so the
                        // label has to live on the link itself.
                        aria-label={t.label}
                        aria-current={active ? "page" : undefined}
                        className={cn(
                            "relative flex shrink-0 items-center gap-1.5 rounded-[9px] px-2.5 py-2 text-[13px] font-semibold transition-colors sm:gap-2 sm:px-3",
                            active
                                ? "text-[color:var(--c-text)]"
                                : "text-[color:var(--c-text-muted)] hover:text-[color:var(--c-text)]",
                        )}
                    >
                        <span
                            className={cn(
                                "grid h-[18px] w-[18px] shrink-0 place-items-center",
                                active ? "text-amber-500" : "text-[color:var(--c-text-dim)]",
                            )}
                        >
                            {t.icon}
                        </span>
                        {/* Hidden on mobile unless this is the active tab; always
                            shown from `sm`. `short` only applies to the mobile
                            case, so the desktop strip keeps the full wording. */}
                        <span className={cn("sm:hidden", active ? "inline" : "hidden")}>{t.short ?? t.label}</span>
                        <span className="hidden sm:inline">{t.label}</span>
                        {active && <span className="absolute inset-x-0 -bottom-px h-[2px] rounded-full bg-[color:var(--c-primary)]" />}
                    </Link>
                )
            })}
        </div>
    )
}

// House style for nav glyphs: 24-unit viewBox, 2px round strokes (see the
// sidebar's RepoIcon family).
function IssuesIcon() {
    return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <circle cx="12" cy="12" r="9" />
            <circle cx="12" cy="12" r="3" />
        </svg>
    )
}

function PullsIcon() {
    return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <circle cx="6" cy="6" r="2.5" />
            <circle cx="6" cy="18" r="2.5" />
            <circle cx="18" cy="18" r="2.5" />
            <path d="M6 8.5v7M18 15.5V9a3 3 0 0 0-3-3h-3.5" />
            <path d="M13 3.5 10.5 6 13 8.5" />
        </svg>
    )
}

function MindIcon() {
    return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M21 12a8 8 0 0 1-8 8H4l1.8-3.2A8 8 0 1 1 21 12z" />
            <path d="M12.5 8.2 13.4 10.6 15.8 11.5 13.4 12.4 12.5 14.8 11.6 12.4 9.2 11.5 11.6 10.6z" />
        </svg>
    )
}

function IntelligenceIcon() {
    return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <circle cx="12" cy="5" r="2.5" />
            <circle cx="5" cy="18" r="2.5" />
            <circle cx="19" cy="18" r="2.5" />
            <path d="M10.6 7.2 6.4 15.8M13.4 7.2l4.2 8.6M7.5 18h9" />
        </svg>
    )
}

function IntegrationsIcon() {
    return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M9 3v5M15 3v5" />
            <path d="M6.5 8h11v4a5.5 5.5 0 0 1-11 0z" />
            <path d="M12 17.5V21" />
        </svg>
    )
}

function SettingsIcon() {
    return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1v.3a2 2 0 1 1-4 0V21a1.6 1.6 0 0 0-2.7-1.2l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.6 1.6 0 0 0 3 15a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 4.3 8.3l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.6 1.6 0 0 0 9.9 4.4V4a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 2.7 1.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0 1.1 2.7h.3a2 2 0 1 1 0 4H21a1.6 1.6 0 0 0-1.5 1z" />
        </svg>
    )
}
