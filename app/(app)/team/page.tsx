"use client"

import { Suspense } from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { cn } from "@/components/ui/cn"
import { useTeam } from "@/lib/client/auth/team-context"
import { MembersTab } from "@/components/teams/members-tab"
import { GroupsTab } from "@/components/teams/groups-tab"
import { SettingsTab } from "@/components/teams/settings-tab"
import { ReviewProfilesTab } from "@/components/teams/review-profiles-tab"

// Team management: the Members tab (roster, roles, email invites) and the Groups
// tab (people-groups + which projects each may access). Acts on the ACTIVE team
// from the top-bar selector; switch teams there to manage a different one.
export default function TeamPage() {
    // useSearchParams must sit under a Suspense boundary for the build.
    return (
        <Suspense fallback={null}>
            <TeamPageInner />
        </Suspense>
    )
}

function TeamPageInner() {
    const { activeTeam, loading, refetch } = useTeam()
    const params = useSearchParams()
    const raw = params.get("tab")
    const tab = raw === "groups" || raw === "settings" || raw === "reviews" ? raw : "members"

    if (loading && !activeTeam) {
        return (
            <div className="w-full px-5 py-6 sm:px-7 sm:py-7">
                <div className="skeleton h-7 w-48 rounded" />
                <div className="skeleton mt-4 h-9 w-64 rounded-[10px]" />
                <div className="skeleton mt-6 h-40 w-full rounded-[16px]" />
            </div>
        )
    }
    if (!activeTeam) {
        return (
            <div className="w-full px-5 py-10 text-center text-[13px] text-[color:var(--c-text-muted)]">
                No team selected.
            </div>
        )
    }

    const isAdmin = activeTeam.role === "owner" || activeTeam.role === "admin"

    return (
        <div className="w-full px-5 py-6 sm:px-7 sm:py-7">
            <header className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <div className="flex items-center gap-2.5">
                        <h1 className="text-[22px] font-bold tracking-[-0.012em]">{activeTeam.name}</h1>
                        <span className="rounded-full bg-[color:var(--c-surface-2)] px-2 py-0.5 text-[11px] font-semibold capitalize text-[color:var(--c-text-muted)]">
                            {activeTeam.role}
                            {activeTeam.is_personal && " · personal"}
                        </span>
                    </div>
                    <p className="mt-1 text-[13px] text-[color:var(--c-text-muted)]">
                        Manage who’s on this team and which projects each group can access.
                    </p>
                </div>
            </header>

            <nav className="mt-5 flex items-center gap-1 border-b border-[color:var(--c-border)]">
                <TabLink href="/team?tab=members" active={tab === "members"} label="Members" />
                <TabLink href="/team?tab=groups" active={tab === "groups"} label="Groups" />
                <TabLink href="/team?tab=reviews" active={tab === "reviews"} label="Reviews" />
                <TabLink href="/team?tab=settings" active={tab === "settings"} label="Settings" />
            </nav>

            <div className="mt-6">
                {tab === "members" && <MembersTab team={activeTeam} isAdmin={isAdmin} onTeamChanged={refetch} />}
                {tab === "groups" && <GroupsTab team={activeTeam} isAdmin={isAdmin} />}
                {tab === "reviews" && <ReviewProfilesTab team={activeTeam} isAdmin={isAdmin} />}
                {tab === "settings" && <SettingsTab team={activeTeam} />}
            </div>
        </div>
    )
}

function TabLink({ href, active, label }: { href: string; active: boolean; label: string }) {
    return (
        <Link
            href={href}
            className={cn(
                "-mb-px border-b-2 px-3 py-2 text-[13px] font-semibold transition-colors",
                active
                    ? "border-[color:var(--c-primary)] text-[color:var(--c-text)]"
                    : "border-transparent text-[color:var(--c-text-muted)] hover:text-[color:var(--c-text)]",
            )}
        >
            {label}
        </Link>
    )
}
