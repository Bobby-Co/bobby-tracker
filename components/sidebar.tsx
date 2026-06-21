"use client"

import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { useState } from "react"
import { cn } from "@/components/cn"
import { useAuth } from "@/lib/auth/auth-context"
import { MiniIcon, toneFromString } from "@/components/field-card"
import PixelGradient, { DARK_EMBER_STOPS } from "@/components/pixel-gradient"
import type { Project } from "@/lib/supabase/types"

interface SidebarProps {
    projects: Project[]
    activeProjectId?: string
    onNavigate?: () => void
}

// Shared row states. On the tinted shell, an active row reads as a
// raised white pill (hairline ring + soft shadow); idle rows are quiet
// and lift on hover with a translucent overlay.
const ROW_ACTIVE =
    "bg-[color:var(--c-surface)] font-semibold text-zinc-900 shadow-[0_1px_3px_rgba(180,83,9,0.12)] ring-1 ring-amber-200/80"
const ROW_IDLE = "text-zinc-600 hover:bg-[color:var(--c-overlay)] bg-zinc-200/50 hover:text-zinc-900"

// SidebarContent mirrors the reference rail top-to-bottom: a workspace
// header (logo + name + panel toggle), a flat icon nav, collapsible
// sentence-case sections with down-carets — "Projects" (the user's real
// projects, as colourful circle items) and "Teams" (a nested expandable
// tree, stubbed to match the reference) — and a user card pinned to the
// bottom. onNavigate fires after any link tap so the mobile drawer can
// close itself.
export function SidebarContent({ projects, activeProjectId, onNavigate }: SidebarProps) {
    const pathname = usePathname()
    const router = useRouter()
    const { user, signOut } = useAuth()
    const [projectsOpen, setProjectsOpen] = useState(true)
    const [teamsOpen, setTeamsOpen] = useState(true)
    const [engOpen, setEngOpen] = useState(true)
    const [signingOut, setSigningOut] = useState(false)

    const isInbox = pathname === "/projects"
    const isGroups = pathname === "/groups" || pathname.startsWith("/groups/")
    const isSessions = pathname === "/sessions" || pathname.startsWith("/sessions/")
    const isWorkers = pathname === "/workers" || pathname.startsWith("/workers")

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
            {/* Faint ember brand bloom at the top — echoes the login panel so
                the rail reads as the same warm Ucelot identity. */}
            <div
                aria-hidden
                className="pointer-events-none absolute -left-6 -top-8 h-40 w-56 bg-[radial-gradient(58%_58%_at_20%_16%,rgba(234,88,12,0.20),rgba(245,158,11,0.12)_45%,transparent_74%)] blur-[16px]"
            />
            {/* Workspace header */}
            <div className="flex h-14 shrink-0 items-center gap-2.5 px-3">
                <span className="relative grid h-8 w-8 shrink-0 place-items-center overflow-hidden rounded-[9px] bg-[#0b090b] text-white shadow-[0_1px_4px_rgba(180,83,9,0.30)] ring-1 ring-amber-900/40">
                    {/* Brand ember — the same dark-ember pixel gradient as the login panel,
                        glowing from the top-left corner behind the mark. */}
                    <PixelGradient stops={DARK_EMBER_STOPS} variant="linear" tiltDeg={45} tilePx={8} tileAspect={1} />
                    <span className="relative z-10 drop-shadow-[0_1px_1px_rgba(0,0,0,0.45)]">
                        <BobbyMark />
                    </span>
                </span>
                <span className="min-w-0 flex-1 truncate text-[14px] font-bold tracking-[-0.01em]">
                    Ucelot
                </span>
                {/* Panel toggle — matches the reference; visual affordance for now. */}
                <button
                    type="button"
                    aria-label="Toggle sidebar"
                    title="Toggle sidebar"
                    className="grid h-7 w-7 shrink-0 place-items-center rounded-[7px] border border-[color:var(--c-border)] text-[color:var(--c-text-dim)] transition-colors hover:bg-[color:var(--c-surface-2)] hover:text-[color:var(--c-text)]"
                >
                    <PanelIcon />
                </button>
            </div>

            {/* Scrollable nav body */}
            <div className="flex-1 overflow-y-auto px-2.5 pb-3 pt-4">
                <div className="flex flex-col gap-[4px]">
                    <NavItem href="/projects" active={isInbox} onNavigate={onNavigate} icon={<RepoIcon />} label="Projects" />
                    <NavItem href="/groups" active={isGroups} onNavigate={onNavigate} icon={<GroupsIcon />} label="Groups" />
                    <NavItem href="/sessions" active={isSessions} onNavigate={onNavigate} icon={<SessionsIcon />} label="Public sessions" />
                    <NavItem href="/workers" active={isWorkers} onNavigate={onNavigate} icon={<WorkersIcon />} label="Local models" />
                </div>

                {/* Projects — real, collapsible, colourful circle items */}
                <SectionHeader label="Projects" open={projectsOpen} onToggle={() => setProjectsOpen((o) => !o)} />
                {projectsOpen && (
                    <div className="mt-0.5 flex flex-col gap-[4px] pl-3">
                        {projects.length === 0 ? (
                            <p className="px-2 py-1.5 text-[12px] text-[color:var(--c-text-dim)]">No projects yet.</p>
                        ) : (
                            projects.map((p) => {
                                const active = p.id === activeProj
                                return (
                                    <Link
                                        key={p.id}
                                        href={`/projects/${p.id}/issues`}
                                        prefetch={false}
                                        onClick={onNavigate}
                                        className={cn(
                                            "group flex items-center w-max gap-2.5 rounded-[9px] px-2.5 py-[3px] text-[13px] transition-colors",
                                            active ? ROW_ACTIVE : ROW_IDLE,
                                        )}
                                    >
                                        <MiniIcon tone={toneFromString(p.name)} size={18}>
                                            <span className="text-[9px] font-bold uppercase">{p.name[0] ?? "?"}</span>
                                        </MiniIcon>
                                        <span className="truncate">{p.name}</span>
                                    </Link>
                                )
                            })
                        )}
                    </div>
                )}

                {/* Teams — stubbed nested tree mirroring the reference. */}
                <SectionHeader label="Teams" open={teamsOpen} onToggle={() => setTeamsOpen((o) => !o)} />
                {teamsOpen && (
                    <div className="mt-0.5 flex flex-col gap-[2px]">
                        <button
                            type="button"
                            onClick={() => setEngOpen((o) => !o)}
                            aria-expanded={engOpen}
                            className="flex items-center gap-2.5 rounded-[9px] px-2.5 py-[3px] text-[13px] font-medium text-zinc-700 transition-colors hover:bg-[color:var(--c-overlay)]"
                        >
                            <span className="grid h-[18px] w-[18px] shrink-0 place-items-center rounded-[6px] bg-emerald-50 text-emerald-600">
                                <CodeBadgeIcon />
                            </span>
                            <span className="min-w-0 flex-1 truncate text-left">Engineering</span>
                            <Caret open={engOpen} />
                        </button>
                        {engOpen && (
                            <div className="mt-0.5 flex flex-col pl-3 gap-[4px]">
                                <TeamLeaf icon={<WorkstreamsIcon />} label="Workstreams" active />
                                <TeamLeaf icon={<ReviewsIcon />} label="Code Reviews" />
                                <TeamLeaf icon={<ModulesIcon />} label="Modules" />
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* User card */}
            <div className="shrink-0 border-t border-[color:var(--c-border)] p-2.5">
                <div className="flex items-center gap-2.5 px-1.5 py-1">
                    {avatarUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={avatarUrl} alt="" className="h-8 w-8 shrink-0 rounded-full object-cover" />
                    ) : (
                        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-zinc-200 text-[11px] font-bold text-zinc-600">
                            {initials}
                        </span>
                    )}
                    <div className="min-w-0 flex-1">
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
                        className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-[color:var(--c-text-dim)] transition-colors hover:bg-[color:var(--c-overlay)] hover:text-[color:var(--c-text)] disabled:opacity-50"
                    >
                        <LogoutIcon />
                    </button>
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
}: {
    href: string
    active: boolean
    icon: React.ReactNode
    label: string
    onNavigate?: () => void
}) {
    return (
        <Link
            href={href}
            prefetch={false}
            onClick={onNavigate}
            className={cn(
                "flex items-center w-max gap-2 rounded-[9px] pl-2.5 pr-4 py-[3px] text-[13px] font-medium transition-colors",
                active ? ROW_ACTIVE : ROW_IDLE,
            )}
        >
            <span className={cn("grid h-[18px] w-[18px] shrink-0 place-items-center", active ? "text-amber-500" : "text-zinc-400")}>
                {icon}
            </span>
            <span className="min-w-0 flex-1 truncate">{label}</span>
        </Link>
    )
}

// Sentence-case section header with a leading-rotation down-caret, like
// the reference's "Starred" / "Teams".
function SectionHeader({ label, open, onToggle }: { label: string; open: boolean; onToggle: () => void }) {
    return (
        <button
            type="button"
            onClick={onToggle}
            aria-expanded={open}
            className="mt-[14px] mb-px flex w-full items-center gap-1.5 px-2.5 py-1 text-[11.5px] font-semibold tracking-[0.01em] text-[color:var(--c-text-muted)] transition-colors hover:text-[color:var(--c-text)]"
        >
            <span>{label}</span>
            <Caret open={open} />
        </button>
    )
}

// A nested team leaf (stub). Rendered as a button so it reads as a row
// without pretending to be a working link.
function TeamLeaf({ icon, label, active }: { icon: React.ReactNode; label: string; active?: boolean }) {
    return (
        <button
            type="button"
            className={cn(
                "flex items-center gap-2.5 w-max rounded-[9px] pl-2.5 pr-3 py-[3px] text-[13px] transition-colors",
                active ? ROW_ACTIVE : ROW_IDLE,
            )}
        >
            <span className={cn("grid h-[18px] w-[18px] shrink-0 place-items-center", active ? "text-amber-500" : "text-zinc-400")}>
                {icon}
            </span>
            <span className="min-w-0 flex-1 truncate text-left">{label}</span>
        </button>
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

// Sidebar — desktop wrapper. Hidden on small screens; the topbar's
// MobileSidebar handles those.
export function Sidebar({ projects, activeProjectId }: SidebarProps) {
    return (
        <aside className="hidden h-full w-64 shrink-0 bg-[color:var(--c-shell)] md:block">
            <SidebarContent projects={projects} activeProjectId={activeProjectId} />
        </aside>
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
function CodeBadgeIcon() {
    return (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M9 8l-4 4 4 4M15 8l4 4-4 4" />
        </svg>
    )
}
function WorkstreamsIcon() {
    return (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <circle cx="6" cy="6" r="2.5" />
            <circle cx="6" cy="18" r="2.5" />
            <circle cx="18" cy="12" r="2.5" />
            <path d="M8.5 6H13a3 3 0 0 1 3 3v0M8.5 18H13a3 3 0 0 0 3-3v0" />
        </svg>
    )
}
function ReviewsIcon() {
    return (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <circle cx="11" cy="11" r="7" />
            <path d="M21 21l-4.3-4.3M8.5 11l2 2 3.5-3.5" />
        </svg>
    )
}
function ModulesIcon() {
    return (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <rect x="4" y="4" width="7" height="7" rx="1.5" />
            <rect x="13" y="4" width="7" height="7" rx="1.5" />
            <rect x="4" y="13" width="7" height="7" rx="1.5" />
            <rect x="13" y="13" width="7" height="7" rx="1.5" />
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
