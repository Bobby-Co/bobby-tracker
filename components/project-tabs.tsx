"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { cn } from "@/components/cn"

export function ProjectTabs({ projectId }: { projectId: string }) {
    const pathname = usePathname()
    const tabs = [
        { href: `/projects/${projectId}/issues`, label: "Issues" },
        { href: `/projects/${projectId}/ask`, label: "Ask" },
        { href: `/projects/${projectId}/knowledge`, label: "Knowledge" },
        { href: `/projects/${projectId}/integrations`, label: "Integrations" },
    ]
    return (
        <div className="mt-4 flex gap-1">
            {tabs.map((t) => {
                const active = pathname === t.href || pathname.startsWith(t.href + "/")
                return (
                    <Link
                        key={t.href}
                        href={t.href}
                        className={cn(
                            "relative px-3 py-2 text-[13px] font-semibold transition-colors",
                            active
                                ? "text-zinc-900"
                                : "text-zinc-500 hover:text-zinc-900",
                        )}
                    >
                        {t.label}
                        {active && <span className="absolute inset-x-0 -bottom-px h-[2px] rounded-full bg-zinc-900" />}
                    </Link>
                )
            })}
        </div>
    )
}
