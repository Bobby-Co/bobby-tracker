"use client"

import type { ReactNode } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { cn } from "@/components/ui/cn"

// Settings shell — owns the page title + the section tab strip so each section
// page (Connections, Usage & Billing) renders only its own content. The redirect
// at /settings lands on the first tab. Mirrors the tabbed nav on /team.
const TABS = [
    { href: "/settings/connections", label: "Connections" },
    { href: "/settings/appearance", label: "Appearance" },
    { href: "/settings/mcp", label: "AI Assistant" },
    { href: "/settings/billing", label: "Usage & Billing" },
]

export default function SettingsLayout({ children }: { children: ReactNode }) {
    const pathname = usePathname()
    return (
        <div className="w-full px-5 py-6 sm:px-7 sm:py-7">
            <header>
                <h1 className="text-[22px] font-bold tracking-[-0.012em]">Settings</h1>
            </header>
            <nav className="mt-4 flex items-center gap-1 border-b border-[color:var(--c-border)]">
                {TABS.map((t) => {
                    const active = pathname === t.href || pathname.startsWith(t.href + "/")
                    return (
                        <Link
                            key={t.href}
                            href={t.href}
                            className={cn(
                                "-mb-px border-b-2 px-3 py-2 text-[13px] font-semibold transition-colors",
                                active
                                    ? "border-[color:var(--c-primary)] text-[color:var(--c-text)]"
                                    : "border-transparent text-[color:var(--c-text-muted)] hover:text-[color:var(--c-text)]",
                            )}
                        >
                            {t.label}
                        </Link>
                    )
                })}
            </nav>
            <div className="mt-6">{children}</div>
        </div>
    )
}
