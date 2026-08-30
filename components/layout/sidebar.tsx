"use client"

import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { createContext, useContext, useState } from "react"
import { cn } from "@/components/ui/cn"
import { useAuth } from "@/lib/client/auth/auth-context"
import { useTeam } from "@/lib/client/auth/team-context"
import { useApi } from "@/lib/client/hooks/use-api"
import { TeamSelector } from "@/components/layout/team-selector"
import { BalancePill } from "@/components/layout/balance-pill"
import { MiniIcon, toneFromString } from "@/components/ui/field-card"
import PixelScatter from "@/components/ui/pixel-scatter"
import type { AccessGroup, Project } from "@/lib/shared/types"
// `m`, not `motion` — the sidebar is on every authed page, so it must not drag
// framer-motion's features into the shell chunk. See components/ui/lazy-motion.tsx.
import { m } from "framer-motion"

interface SidebarProps {
    projects: Project[]
    activeProjectId?: string
    onNavigate?: () => void
}

// The user's manual collapse control. Provided by the app shell (which owns the
// persisted state and folds the shell to match); consumed by the brand header's
// toggle. Null where no manual toggle exists — the mobile drawer and the
// loading skeleton, which are always full — so the button simply isn't drawn
// there rather than doing nothing.
const SidebarToggleContext = createContext<(() => void) | null>(null)

export function SidebarToggleProvider({ toggle, children }: { toggle: (() => void) | null; children: React.ReactNode }) {
    return <SidebarToggleContext.Provider value={toggle}>{children}</SidebarToggleContext.Provider>
}

function useSidebarToggle(): (() => void) | null {
    return useContext(SidebarToggleContext)
}

// Shared row states. On the tinted shell, an active row reads as a
// raised white pill (hairline ring + soft shadow); idle rows are quiet
// and lift on hover with a translucent overlay.
const ROW_ACTIVE =
    "bg-[color:var(--c-surface)] font-semibold text-[color:var(--c-text)] shadow-[0_1px_3px_rgba(180,83,9,0.12)] ring-1 ring-[color:var(--c-border-strong)]"
const ROW_IDLE = "text-[color:var(--c-text-muted)] hover:bg-[color:var(--c-overlay)] bg-[color:var(--c-border)]/50 hover:text-[color:var(--c-text)]"

// SidebarContent mirrors the reference rail top-to-bottom: a workspace
// header (logo + name + panel toggle), a flat icon nav, collapsible
// sentence-case sections with down-carets — "Projects" (the user's real
// projects, as colourful circle items) and "Teams" (a nested expandable
// tree, stubbed to match the reference) — and a user card pinned to the
// bottom. onNavigate fires after any link tap so the mobile drawer can
// close itself.
export function SidebarContent({ projects, activeProjectId, onNavigate, collapsed = false }: SidebarProps & { collapsed?: boolean }) {
    const pathname = usePathname()
    const router = useRouter()
    const { user, signOut } = useAuth()
    const { activeTeam } = useTeam()
    // The active team's people-groups (access control), shown as a live section.
    const { data: groupsData } = useApi<{ groups: AccessGroup[] }>(
        activeTeam ? `/api/teams/${activeTeam.id}/groups` : null,
        { enabled: !!activeTeam },
    )
    const groups = groupsData?.groups ?? []
    // "Featured" = the most recently active projects, capped so the rail stays
    // compact. The /api/projects list arrives ordered updated_at desc, so the
    // head is the most-recently-touched; the full list lives on the Projects page.
    const featured = projects.slice(0, 5)
    const [projectsOpen, setProjectsOpen] = useState(true)
    const [groupsOpen, setGroupsOpen] = useState(true)
    const [signingOut, setSigningOut] = useState(false)
    const isSettings = pathname === "/settings" || pathname.startsWith("/settings")

    const urlMatch = pathname.match(/^\/projects\/([^/]+)/)
    const activeProj = activeProjectId ?? urlMatch?.[1]

    const name =
        (user?.user_metadata?.full_name as string) ||
        (user?.user_metadata?.name as string) ||
        user?.email?.split("@")[0] ||
        "Account"
    const avatarUrl = user?.user_metadata?.avatar_url as string | undefined
    const initials =
        name
            .split(/\s+/)
            .slice(0, 2)
            .map((s) => s[0]?.toUpperCase() ?? "")
            .join("") || "U"

    async function handleSignOut() {
        setSigningOut(true)
        await signOut()
        router.replace("/login")
    }

    return (
        <nav className="relative flex h-full flex-col pt-2 pl-2">
            <SidebarBloom />
            {/* Ember pixel bloom from the bottom-left corner — the landing's
                scatter, anchored under the account card so the rail is
                book-ended by the Ucelot identity (pixel logo at the top). */}
            <div aria-hidden className="pointer-events-none absolute bottom-0 left-0 h-56 w-full overflow-hidden">
                <PixelScatter corners={["bl"]} cell={20} fill={0.5} animate={false} className="opacity-90" />
            </div>
            {/* Content sits above the decorative ember layers (logo + blooms). */}
            <div className="relative flex min-h-0 flex-1 flex-col">
            <SidebarBrand collapsed={collapsed} />

            {/* Team switcher — the active workspace. Sits above the scroll body so
                its dropdown isn't clipped by the nav's overflow. */}
            <div className="relative z-30 px-2.5 pt-1.5 pb-1">
                <FoldRow collapsed={collapsed}>
                    <div className="mb-1 px-0.5 text-[11.5px] font-semibold tracking-wide text-[color:var(--c-text-muted)]">
                        Team
                    </div>
                </FoldRow>
                <TeamSelector collapsed={collapsed} />
                {/* Prowl Points balance — team-scoped, so it sits with the team switch. */}
                <BalancePill collapsed={collapsed} />
            </div>

            {/* Scrollable nav body. overflow-x hidden so a label mid-fold never
                bleeds a scrollbar into the rail. */}
            <div className="flex-1 overflow-y-auto overflow-x-hidden px-2.5 pb-3 pt-3">
                <SidebarPrimaryNav onNavigate={onNavigate} collapsed={collapsed} />

                {/* Featured — the most recently active projects (up to 5). The
                    full list lives on the Projects page. */}
                <SectionHeader label="Featured" open={projectsOpen} onToggle={() => setProjectsOpen((o) => !o)} collapsed={collapsed} />
                {/* The row fade-in is CSS (.stagger + .anim-fade), not motion: it runs
                    on MOUNT, and the motion features load asynchronously now, so a
                    JS-driven entrance would be skipped on a cold load — the one
                    animation here that has to be frame-one ready. 20ms/row matches
                    the old `delay: 0.02*i`. Collapsed forces the list open — there
                    is no header to toggle it with. */}
                {(projectsOpen || collapsed) && (
                    <m.div
                        layout="position"
                        className={cn("stagger mt-0.5 flex flex-col gap-[4px] transition-[padding] duration-500", collapsed ? "pl-0" : "pl-3")}
                        style={{ ["--stagger-step" as string]: "20ms" } as React.CSSProperties}
                    >
                        {featured.length === 0 ? (
                            !collapsed && <p className="px-2 py-1.5 text-[12px] text-[color:var(--c-text-dim)]">No projects yet.</p>
                        ) : (
                            featured.map((p, i) => {
                                const active = p.id === activeProj
                                return (
                                    <Link
                                        key={p.id}
                                        href={`/projects/${p.id}/issues`}
                                        prefetch={false}
                                        onClick={onNavigate}
                                        title={collapsed ? p.name : undefined}
                                        className="anim-fade"
                                        style={{ ["--i" as string]: i } as React.CSSProperties}
                                    >
                                        <div className={cn(
                                            "group flex w-max items-center rounded-[9px] py-[3px] text-[13px] transition-[padding,background-color] duration-500",
                                            collapsed ? "pl-2.5 pr-2.5" : "pl-2.5 pr-2.5",
                                            active ? ROW_ACTIVE : ROW_IDLE,
                                        )}>
                                            <MiniIcon tone={toneFromString(p.name)} size={18}>
                                                <span className="text-[9px] font-bold uppercase">{p.name[0] ?? "?"}</span>
                                            </MiniIcon>
                                            <FoldingLabel collapsed={collapsed} className="ml-2.5 truncate">{p.name}</FoldingLabel>
                                        </div>
                                    </Link>
                                )
                            })
                        )}
                    </m.div>
                )}

                {/* Groups — the active team's people-groups (repo access control).
                    Each links to the team's management page. */}
                <SectionHeader label="Groups" open={groupsOpen} onToggle={() => setGroupsOpen((o) => !o)} collapsed={collapsed} />
                {(groupsOpen || collapsed) && (
                    <m.div layout="position" className={cn("mt-0.5 flex flex-col gap-[2px] transition-[padding] duration-500", collapsed ? "pl-0" : "pl-3")}>
                        {groups.length === 0 ? (
                            !collapsed && (
                                <Link
                                    href="/team?tab=groups"
                                    onClick={onNavigate}
                                    className="px-2.5 py-1.5 text-[12px] text-[color:var(--c-text-dim)] transition-colors hover:text-[color:var(--c-text)]"
                                >
                                    No groups yet — manage team →
                                </Link>
                            )
                        ) : (
                            groups.map((g) => (
                                <Link
                                    key={g.id}
                                    href="/team?tab=groups"
                                    onClick={onNavigate}
                                    title={collapsed ? g.name : undefined}
                                    className={cn(
                                        "flex w-max items-center rounded-sq-l py-[3px] pl-2.5 pr-2.5 text-[13px]",
                                        ROW_IDLE,
                                    )}
                                >
                                    <span className="grid h-[18px] w-[18px] shrink-0 place-items-center rounded-[6px] bg-emerald-50 text-emerald-600">
                                        <GroupLeafIcon />
                                    </span>
                                    <FoldingLabel collapsed={collapsed} className="ml-2.5 truncate text-left">{g.name}</FoldingLabel>
                                </Link>
                            ))
                        )}
                    </m.div>
                )}
            </div>

            {/* Settings — pinned just above the account card so account-level
                config (VCS connections, …) is always one click away. */}
            <div className="shrink-0 px-2.5 pb-1 pt-1">
                <NavItem
                    href="/settings/connections"
                    active={isSettings}
                    onNavigate={onNavigate}
                    icon={<SettingsIcon />}
                    label="Settings"
                    collapsed={collapsed}
                />
            </div>

            {/* User card — folds to just the avatar. */}
            <div className="shrink-0 border-t border-[color:var(--c-border)] p-2.5">
                <div className="flex items-center px-1.5 py-1">
                    {avatarUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={avatarUrl} alt="" title={collapsed ? name : undefined} className="h-8 w-8 shrink-0 rounded-full object-cover" />
                    ) : (
                        <span title={collapsed ? name : undefined} className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[color:var(--c-border)] text-[11px] font-bold text-[color:var(--c-text-muted)]">
                            {initials}
                        </span>
                    )}
                    <div
                        className={cn(
                            "min-w-0 overflow-hidden transition-[max-width,opacity,margin] duration-500",
                            collapsed ? "ml-0 max-w-0 opacity-0" : "ml-2.5 max-w-[160px] flex-1 opacity-100",
                        )}
                    >
                        <div className="truncate text-[12.5px] font-semibold leading-tight">{name}</div>
                        {user?.email && (
                            <div className="truncate text-[11px] leading-tight text-[color:var(--c-text-muted)]">
                                {user.email}
                            </div>
                        )}
                    </div>
                    <button
                        type="button"
                        onClick={handleSignOut}
                        disabled={signingOut}
                        aria-label="Sign out"
                        title="Sign out"
                        className={cn(
                            "grid h-7 shrink-0 place-items-center overflow-hidden rounded-md text-[color:var(--c-text-dim)] transition-[max-width,opacity] duration-500 hover:bg-[color:var(--c-overlay)] hover:text-[color:var(--c-text)] disabled:opacity-50",
                            collapsed ? "pointer-events-none max-w-0 opacity-0" : "max-w-[28px] w-7 opacity-100",
                        )}
                    >
                        <LogoutIcon />
                    </button>
                </div>
            </div>
            </div>
        </nav>
    )
}

function NavItem({
    href,
    active,
    icon,
    label,
    onNavigate,
    collapsed = false,
}: {
    href: string
    active: boolean
    icon: React.ReactNode
    label: string
    onNavigate?: () => void
    collapsed?: boolean
}) {
    return (
        <Link
            href={href}
            prefetch={false}
            onClick={onNavigate}
            title={collapsed ? label : undefined}
            className={cn(
                "flex w-max items-center rounded-sq-l py-[3px] pl-2.5 text-[13px] font-medium transition-[padding] duration-500",
                collapsed ? "pr-2.5" : "pr-4",
                active ? ROW_ACTIVE : ROW_IDLE,
            )}
        >
            <span className={cn("grid h-[18px] w-[18px] shrink-0 place-items-center", active ? "text-amber-500" : "text-[color:var(--c-text-dim)]")}>
                {icon}
            </span>
            <FoldingLabel collapsed={collapsed} className="ml-2 truncate">{label}</FoldingLabel>
        </Link>
    )
}

// Sentence-case section header with a leading-rotation down-caret, like
// the reference's "Starred" / "Teams". On collapse the CAPTION fades but its
// box KEEPS its height, so the icons below hold their vertical position — the
// rail is a pure width morph, nothing rides up.
function SectionHeader({ label, open, onToggle, collapsed = false }: { label: string; open: boolean; onToggle: () => void; collapsed?: boolean }) {
    return (
        <m.button
            layout="position"
            type="button"
            onClick={onToggle}
            aria-expanded={open}
            aria-hidden={collapsed}
            tabIndex={collapsed ? -1 : undefined}
            className={cn(
                "mt-[14px] mb-px flex max-h-8 w-full items-center gap-1.5 overflow-hidden px-1 py-1 text-[11.5px] font-semibold tracking-[0.01em] text-[color:var(--c-text-muted)] transition-opacity duration-500 hover:text-[color:var(--c-text)]",
                collapsed ? "pointer-events-none opacity-0" : "opacity-100",
            )}
        >
            <span>{label}</span>
            <Caret open={open} />
        </m.button>
    )
}

/** A vertical fold for a text-only row (e.g. the "Team" caption): on collapse the
 *  text fades but the row KEEPS its height, so nothing below shifts up. */
function FoldRow({ collapsed, children }: { collapsed: boolean; children: React.ReactNode }) {
    return (
        <div
            aria-hidden={collapsed}
            className={cn(
                "max-h-8 overflow-hidden transition-opacity duration-500",
                collapsed ? "pointer-events-none opacity-0" : "opacity-100",
            )}
        >
            {children}
        </div>
    )
}

function Caret({ open }: { open: boolean }) {
    return (
        <svg
            width="11"
            height="11"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
            className={cn("text-[color:var(--c-text-dim)] transition-transform", open ? "rotate-0" : "-rotate-90")}
        >
            <path d="M6 9l6 6 6-6" />
        </svg>
    )
}

export type SidebarMode = "full" | "rail" | "hidden"

const RAIL_W = 68

// Sidebar — desktop wrapper. Hidden on small screens; the topbar's
// MobileSidebar handles those. Three states, all animated:
//   · "full"   the w-64 rail (default)
//   · "rail"   a 60px icon strip — the SAME SidebarContent, its labels folded
//              away, so it MORPHS rather than swapping to different markup. Used
//              while the composer takes the width (see issue-composer.tsx).
//   · "hidden" width → 0 for the immersive Mind view — here the inner content
//              keeps its full 256 width and is clipped, so the whole rail glides
//              out intact instead of collapsing to icons on its way off-screen.
export function Sidebar({
    projects,
    activeProjectId,
    mode = "full",
}: SidebarProps & { mode?: SidebarMode }) {
    const rail = mode === "rail"
    const hidden = mode === "hidden"
    return (
        <aside
            className={cn(
                "hidden h-full shrink-0 overflow-hidden bg-[color:var(--c-shell)] transition-[width,opacity] duration-500 md:block",
                hidden && "opacity-0",
            )}
            style={{ width: hidden ? 0 : rail ? RAIL_W : 256 }}
        >
            {/* Inner width tracks the aside EXCEPT when hidden, where it holds at
                256 so the full content glides out rather than collapsing first. */}
            <div className="h-full transition-[width] duration-500" style={{ width: hidden ? 256 : rail ? RAIL_W : 256 }}>
                <SidebarContent projects={projects} activeProjectId={activeProjectId} collapsed={rail} />
            </div>
        </aside>
    )
}

/** A row label that folds to nothing on collapse. Kept mounted and animated on
 *  BOTH width and its left margin, so the icon to its left never moves — the
 *  text simply slides shut. `whitespace-nowrap` stops it wrapping to two lines
 *  as the rail narrows before it has finished closing. */
function FoldingLabel({
    collapsed,
    children,
    className,
    max = 180,
}: {
    collapsed: boolean
    children: React.ReactNode
    className?: string
    max?: number
}) {
    return (
        <span
            aria-hidden={collapsed}
            className={cn(
                "overflow-hidden whitespace-nowrap transition-[max-width,opacity,margin] duration-500",
                collapsed ? "ml-0 max-w-0 opacity-0" : "opacity-100",
                className,
            )}
            style={{ maxWidth: collapsed ? 0 : max, marginLeft: collapsed ? 0 : undefined }}
        >
            {children}
        </span>
    )
}

// ── icons ───────────────────────────────────────────────────────────────
function RepoIcon() {
    return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M4 4h12a4 4 0 014 4v12H8a4 4 0 01-4-4V4z" />
            <path d="M4 16a4 4 0 014-4h12" />
        </svg>
    )
}
function GroupsIcon() {
    return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M16 18a4 4 0 0 0-8 0M12 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM5 19a3 3 0 0 1 3-3M19 19a3 3 0 0 0-3-3" />
        </svg>
    )
}
function SessionsIcon() {
    return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <circle cx="18" cy="5" r="3" />
            <circle cx="6" cy="12" r="3" />
            <circle cx="18" cy="19" r="3" />
            <path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4" />
        </svg>
    )
}
function WorkersIcon() {
    return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <rect x="7" y="7" width="10" height="10" rx="1.5" />
            <path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3" />
        </svg>
    )
}
function GroupLeafIcon() {
    return (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <circle cx="9" cy="8" r="3" />
            <path d="M15.5 8a3 3 0 1 0 0 .01M4 20a5 5 0 0 1 10 0M14 20a5 5 0 0 1 6-4.5" />
        </svg>
    )
}
function SettingsIcon() {
    return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
    )
}
function PanelIcon() {
    return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <rect x="3" y="4" width="18" height="16" rx="2.5" />
            <path d="M9 4v16" />
        </svg>
    )
}
function LogoutIcon() {
    return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
            <path d="M16 17l5-5-5-5M21 12H9" />
        </svg>
    )
}

const BobbyMark = () => (
    <svg width={18} height={18} viewBox="0 0 106 102" xmlns="http://www.w3.org/2000/svg" aria-hidden>
        <path
            fill="currentColor"
            d="M 95.59375 67.023438 L 95.609375 17.179688 C 95.610001 12.229996 91.550003 8.239998 86.589996 8.339996 C 81.720001 8.43 77.919998 12.610001 77.919998 17.470001 L 77.921875 32.132813 C 77.919998 36.360001 74.559998 39.91 70.330002 39.950001 L 68.539063 39.84375 C 64.690002 39.32 61.84 35.979996 61.84 32.089996 L 61.84375 18.078125 C 61.84 14.139999 59.560001 10.470001 55.919998 8.959999 C 52.259998 7.440002 49.66 9.010002 47.189999 10.520004 C 44.529999 12.129997 36.509998 16.379997 36.509998 16.379997 L 36.03125 16.640625 L 35.546875 16.382813 C 35.549999 16.379997 27.440001 12.099998 25.32 10.770004 C 22.82 9.199997 20.280001 7.440002 16.540001 8.870003 C 12.78 10.309998 10.39 14.050003 10.39 18.089996 L 10.390625 67.023438 C 10.84 79.970001 21.459999 90.339996 34.509998 90.339996 L 71.492188 90.34375 C 84.540001 90.339996 95.160004 79.970001 95.59375 67.023438 Z M 23.25 40.460938 C 21.219999 39.689999 19.780001 37.729996 19.780001 35.419998 C 19.780001 33.110001 21.219999 31.150002 23.25 30.370003 C 23.860001 30.129997 24.52 30 25.200001 30 C 26.26 30 27.24 30.309998 28.08 30.839996 C 29.6 31.800003 30.610001 33.490005 30.610001 35.419998 C 30.610001 37.349998 29.6 39.049999 28.08 40 C 27.24 40.529999 26.26 40.830002 25.200001 40.830002 C 24.52 40.830002 23.860001 40.700001 23.25 40.460938 Z M 44.15625 39.609375 C 42.939999 38.619999 42.169998 37.110001 42.169998 35.419998 C 42.169998 33.729996 42.939999 32.220001 44.16 31.229996 C 45.09 30.459999 46.279999 30 47.580002 30 C 49.07 30 50.41 30.599998 51.389999 31.57 C 52.389999 32.559998 53 33.919998 53 35.419998 C 53 36.93 52.389999 38.279999 51.389999 39.259998 C 50.41 40.240002 49.07 40.830002 47.580002 40.830002 C 46.279999 40.830002 45.09 40.369999 44.15625 39.609375 Z M 34.507813 81.492188 C 26.360001 81.489998 19.68 75.07 19.26 67.019997 L 29.6875 67.023438 L 29.6875 60.148438 C 29.690001 58.169998 31.290001 56.57 33.27 56.57 L 42.1875 56.570313 C 44.169998 56.57 45.77 58.169998 45.77 60.150002 L 45.773438 67.023438 L 58.632813 67.023438 L 58.632813 60.148438 C 58.630001 58.169998 60.23 56.57 62.209999 56.57 L 71.132813 56.570313 C 73.110001 56.57 74.709999 58.169998 74.709999 60.150002 L 74.710938 67.023438 L 86.742188 67.023438 C 86.32 75.07 79.639999 81.489998 71.489998 81.489998 Z"
        />
    </svg>
)

/** The faint ember bloom behind the top of the rail — echoes the login panel so
 *  the sidebar reads as the same warm Ucelot identity.
 *
 *  Pure CSS, so it paints with the first frame and needs no skeleton of its own.
 *  It is exported for the opposite reason: it lived INSIDE the real sidebar, and
 *  ShellSkeleton drew a bare rail without it — so on every refresh the flare
 *  appeared only once the session resolved and the real sidebar mounted. Nothing
 *  about it depends on the session. */
export function SidebarBloom() {
    return (
        <div
            aria-hidden
            className="pointer-events-none absolute -left-6 -top-8 h-40 w-56 bg-[radial-gradient(58%_58%_at_20%_16%,rgba(234,88,12,0.20),rgba(245,158,11,0.12)_45%,transparent_74%)] blur-[16px]"
        />
    )
}

/** The brand mark's ember, as the 8×8 pixels PixelGradient would paint with
 *  DARK_EMBER_STOPS, variant="linear", tiltDeg={45}, tilePx={8}. Upscaled with
 *  image-rendering: pixelated, so it is identical to the canvas output. */
const BRAND_EMBER_8X8 =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAkUlEQVR4AXzOvQqCYBTG8YezRZfQ1NDSDdTYEDU0RENL0N4lNHUfXUc30BqNToLgJIIiCOIXvr6POggi6vzj/M8j/D7ovff8PA983c+8HG/cbq5crU9cLHcU37TwswV/ZwbDm8MNCwRRgiSNkWUxZAqVyiFjlw1SK8hQtkXqEtL/2UWyLnQH9VE3hXbtEFIrVAAAAP//fjrJVAAAAAZJREFUAwBfaKlwTAiYngAAAABJRU5ErkJggg=="

/** The workspace header: brand mark, product name, panel toggle.
 *
 *  Exported because ShellSkeleton renders it too. None of it depends on the
 *  session, so showing a grey square here instead — as the skeleton used to —
 *  was inventing a loading state for something already known, and the swap to
 *  the real mark was a visible flicker on every hard navigation (which is what a
 *  team switch is). */
export function SidebarBrand({ collapsed = false }: { collapsed?: boolean }) {
    // The manual collapse control, when the shell provides one. In the rail the
    // dedicated toggle folds away, so the logo itself becomes the expand button —
    // meaning there's always a way back out.
    const toggle = useSidebarToggle()
    /* Brand ember — the exact 8×8 image <PixelGradient> paints, baked to a data
       URI and upscaled with the same `pixelated` rendering. PixelGradient draws a
       <canvas> in useEffect, blank through SSR/first paint; on a 32px mark that
       is the logo flashing on every load. An 8×8 PNG (not a CSS gradient) because
       the canvas draws SQUARE TILES — equal-width diagonal stops would stripe.
       318 bytes, no request, no JS. */
    const markClass =
        "relative grid h-8 w-8 shrink-0 place-items-center overflow-hidden rounded-[9px] text-white shadow-[0_1px_4px_rgba(180,83,9,0.30)] ring-1 ring-[color:var(--c-border)]"
    const markStyle: React.CSSProperties = {
        backgroundImage: `url("${BRAND_EMBER_8X8}")`,
        backgroundSize: "100% 100%",
        imageRendering: "pixelated",
    }
    const mark = (
        <span className="relative z-10 drop-shadow-[0_1px_1px_rgba(0,0,0,0.45)]">
            <BobbyMark />
        </span>
    )

    return (
        <div className="flex h-14 shrink-0 items-center px-3">
            {toggle ? (
                <button
                    type="button"
                    onClick={toggle}
                    aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
                    title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
                    className={cn(markClass, "transition-shadow hover:ring-2 hover:ring-[color:var(--c-ring)]")}
                    style={markStyle}
                >
                    {mark}
                </button>
            ) : (
                <span className={markClass} style={markStyle}>
                    {mark}
                </span>
            )}
            <FoldingLabel collapsed={collapsed} className="ml-2.5 min-w-0 truncate text-[14px] font-bold tracking-[-0.01em]" max={120}>
                Ucelot
            </FoldingLabel>
            {/* Dedicated collapse button. Folds away in the rail — where the logo
                takes over as the expand control. Hidden entirely when there's no
                toggle to drive (mobile drawer, skeleton). */}
            {toggle ? (
                <button
                    type="button"
                    onClick={toggle}
                    aria-label="Collapse sidebar"
                    title="Collapse sidebar"
                    aria-hidden={collapsed}
                    tabIndex={collapsed ? -1 : undefined}
                    className={cn(
                        "ml-auto grid h-7 shrink-0 place-items-center overflow-hidden rounded-[7px] text-[color:var(--c-text-dim)] transition-[max-width,opacity,border-color] duration-500 hover:bg-[color:var(--c-surface-2)] hover:text-[color:var(--c-text)]",
                        collapsed ? "pointer-events-none max-w-0 border-0 opacity-0" : "max-w-[28px] w-7 border border-[color:var(--c-border)] opacity-100",
                    )}
                >
                    <PanelIcon />
                </button>
            ) : null}
        </div>
    )
}

/** The four fixed destinations. Their labels, icons, order and hrefs are all
 *  known at build time and the active one comes from the URL, so nothing here
 *  waits on a session.
 *
 *  Exported because ShellSkeleton renders it too. It used to draw four grey
 *  rectangles in this spot — a loading state for a list that cannot load. */
export function SidebarPrimaryNav({ onNavigate, collapsed = false }: { onNavigate?: () => void; collapsed?: boolean }) {
    const pathname = usePathname()
    return (
        <div className="flex flex-col gap-[4px]">
            <NavItem href="/projects" active={pathname === "/projects"} onNavigate={onNavigate} icon={<RepoIcon />} label="Projects" collapsed={collapsed} />
            <NavItem href="/groups" active={pathname === "/groups" || pathname.startsWith("/groups/")} onNavigate={onNavigate} icon={<GroupsIcon />} label="Collections" collapsed={collapsed} />
            <NavItem href="/sessions" active={pathname === "/sessions" || pathname.startsWith("/sessions/")} onNavigate={onNavigate} icon={<SessionsIcon />} label="Public sessions" collapsed={collapsed} />
            <NavItem href="/workers" active={pathname.startsWith("/workers")} onNavigate={onNavigate} icon={<WorkersIcon />} label="Local models" collapsed={collapsed} />
        </div>
    )
}
