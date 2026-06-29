import Link from "next/link"
import { cn } from "@/components/cn"
import { FieldTable, FieldRow, SegBar } from "@/components/field-card"
import { shortDate, timeAgo } from "@/components/issue-meta"
import type { Project } from "@/lib/supabase/types"
import { IconlyCode } from "@/icons/Iconly-code-icon"
import { IconlyFoldercode } from "@/icons/Iconly-folder-code-icon"
import { IconlyRocket } from "@/icons/Iconly-rocket-icon"
import { IconlyDatabase } from "@/icons/Iconly-database-icon"
import { IconlyCategory } from "@/icons/Iconly-category-icon"
import { IconlyActivity } from "@/icons/Iconly-activity-icon"
import { IconlyGraph } from "@/icons/Iconly-graph-icon"
import { IconlyGridinterface } from "@/icons/Iconly-grid-interface-icon"
import { IconlyDiscovery } from "@/icons/Iconly-discovery-icon"
import { IconlyDiamondstar } from "@/icons/Iconly-diamond-star-icon"
import { IconlyChartcircle } from "@/icons/Iconly-chart-circle-icon"
import { IconlyPaper } from "@/icons/Iconly-paper-icon"
import { motion } from "framer-motion"

// Reference-driven project tile: a coloured org header bar (org name +
// people, top-right), a colour-matched circular project glyph, the field
// table, and a variant footer (progress / clear / critical / pr).
//
// The org colour is pulled from the org chip palette and hashed off the org
// key, so every project under the same org shares one chip. The glyph
// icon + the footer status + the people count are STUBBED here (derived
// deterministically from the id) — the real issue/PR/people data gets wired
// to the same props later.

// Status footer variants — stubbed for now, data-driven later.
export type ProjectStatus =
    | { kind: "progress"; done: number; total: number }
    | { kind: "clear" }
    | { kind: "critical"; count: number }
    | { kind: "pr"; count: number }

// FNV-1a 32-bit — stable per-string hash (matches lib/timeline/labels).
function hash(s: string): number {
    let h = 0x811c9dc5
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i)
        h = Math.imul(h, 0x01000193)
    }
    return h >>> 0
}

// Project glyph icons — drawn from the project's Iconly set. Picked by a
// stable hash so each project keeps a consistent icon (real per-project icon
// wired later).
const ICONS = [
    IconlyCode,
    IconlyFoldercode,
    IconlyRocket,
    IconlyDatabase,
    IconlyCategory,
    IconlyActivity,
    IconlyGraph,
    IconlyGridinterface,
    IconlyDiscovery,
    IconlyDiamondstar,
    IconlyChartcircle,
    IconlyPaper,
]

// Org colour chips — a light tint (bg) paired with a saturated tone (fg),
// hashed off the org key so every project under one org shares a chip. Both
// tones reference the --app-* palette in globals.css (single source of truth).
const CHIP_PALETTE = [
    // reds & pinks
    { bg: "var(--app-crimson-bg)", fg: "var(--app-crimson)" },
    { bg: "var(--app-rose-bg)", fg: "var(--app-rose)" },
    { bg: "var(--app-pink-bg)", fg: "var(--app-pink)" },
    { bg: "var(--app-blush-bg)", fg: "var(--app-blush)" },
    { bg: "var(--app-magenta-bg)", fg: "var(--app-magenta)" },
    { bg: "var(--app-fuchsia-bg)", fg: "var(--app-fuchsia)" },
    // purples
    { bg: "var(--app-orchid-bg)", fg: "var(--app-orchid)" },
    { bg: "var(--app-purple-bg)", fg: "var(--app-purple)" },
    { bg: "var(--app-violet-bg)", fg: "var(--app-violet)" },
    { bg: "var(--app-lavender-bg)", fg: "var(--app-lavender)" },
    { bg: "var(--app-periwinkle-bg)", fg: "var(--app-periwinkle)" },
    // blues
    { bg: "var(--app-indigo-bg)", fg: "var(--app-indigo)" },
    { bg: "var(--app-blue-bg)", fg: "var(--app-blue)" },
    { bg: "var(--app-azure-bg)", fg: "var(--app-azure)" },
    { bg: "var(--app-sky-bg)", fg: "var(--app-sky)" },
    { bg: "var(--app-cyan-bg)", fg: "var(--app-cyan)" },
    // greens & teals
    { bg: "var(--app-teal-bg)", fg: "var(--app-teal)" },
    { bg: "var(--app-mint-bg)", fg: "var(--app-mint)" },
    { bg: "var(--app-spruce-bg)", fg: "var(--app-spruce)" },
    { bg: "var(--app-emerald-bg)", fg: "var(--app-emerald)" },
    { bg: "var(--app-green-bg)", fg: "var(--app-green)" },
    { bg: "var(--app-fern-bg)", fg: "var(--app-fern)" },
    { bg: "var(--app-sage-bg)", fg: "var(--app-sage)" },
    { bg: "var(--app-lime-bg)", fg: "var(--app-lime)" },
    // yellows & gold
    { bg: "var(--app-olive-bg)", fg: "var(--app-olive)" },
    { bg: "var(--app-citron-bg)", fg: "var(--app-citron)" },
    { bg: "var(--app-gold-bg)", fg: "var(--app-gold)" },
    { bg: "var(--app-yellow-bg)", fg: "var(--app-yellow)" },
    { bg: "var(--app-amber-bg)", fg: "var(--app-amber)" },
    { bg: "var(--app-honey-bg)", fg: "var(--app-honey)" },
    // oranges & earth
    { bg: "var(--app-tangerine-bg)", fg: "var(--app-tangerine)" },
    { bg: "var(--app-orange-bg)", fg: "var(--app-orange)" },
    { bg: "var(--app-peach-bg)", fg: "var(--app-peach)" },
    { bg: "var(--app-coral-bg)", fg: "var(--app-coral)" },
    { bg: "var(--app-clay-bg)", fg: "var(--app-clay)" },
    { bg: "var(--app-brown-bg)", fg: "var(--app-brown)" },
    { bg: "var(--app-sand-bg)", fg: "var(--app-sand)" },
    // neutrals
    { bg: "var(--app-slate-bg)", fg: "var(--app-slate)" },
    { bg: "var(--app-stone-bg)", fg: "var(--app-stone)" },
    { bg: "var(--app-graphite-bg)", fg: "var(--app-graphite)" },
]

// Everything not yet in the data model is derived from a stable hash so the
// tile looks real and consistent across renders. Swap these for real fields
// (status, members) when they land.
function stubMeta(p: Project) {
    const orgKey = (p.repo_full_name?.split("/")[0] || p.name).trim()
    const h = hash(p.id || p.name)
    const chip = CHIP_PALETTE[hash(orgKey) % CHIP_PALETTE.length]
    const Icon = ICONS[h % ICONS.length]
    const people = 3 + (hash(orgKey + ":people") % 26)

    let status: ProjectStatus
    switch (h % 4) {
        case 0: {
            const total = 4 + (h % 8)
            status = { kind: "progress", done: Math.max(1, total - 1 - (h % 3)), total }
            break
        }
        case 1:
            status = { kind: "clear" }
            break
        case 2:
            status = { kind: "critical", count: 1 + (h % 2) }
            break
        default:
            status = { kind: "pr", count: 1 + (h % 2) }
    }

    return { orgKey, orgName: orgKey, chip, Icon, people, status }
}

export function ProjectTile({ project, status: statusOverride }: { project: Project; status?: ProjectStatus }) {
    const stub = stubMeta(project)
    const { orgName, chip, Icon, people } = stub
    const status = statusOverride ?? stub.status
    const desc = project.description
    const peopleLabel = people >= 20 ? "20+ People" : `${people} People`

    return (
        <Link             href={`/projects/${project.id}/issues`}
                          prefetch={false}>
            <motion.div
                whileHover={{ y: -3 }}
                transition={{type: "spring", stiffness: 300, damping: 20}}
                className="block h-full rounded-sq-xl shadow-xs border border-[color:var(--c-border)] bg-white focus:outline-none"
            >
                {/* Org header bar — chip tint from the --app-* palette, same per org. */}
                <div className="relative rounded-sq-t-xl pt-2 pb-7.5" style={{ backgroundColor: chip.bg, color: chip.fg }}>
                    <div className="flex items-center relative px-4 justify-between gap-2">
                        <span className="min-w-0 truncate text-[16px] font-extrabold tracking-[-0.01em]">{orgName}</span>
                        <span className="flex shrink-0 items-center gap-2">
                    <span className="flex items-center -space-x-1.5">
                        {Array.from({ length: Math.min(3, people) }).map((_, i) => (
                            <span
                                key={i}
                                className="h-4 w-4 rounded-full"
                                style={{ backgroundColor: chip.fg, boxShadow: `0 0 0 2px ${chip.bg}` }}
                            />
                        ))}
                    </span>
                    <span className="text-[12px] font-bold">{peopleLabel}</span>
                </span>
                    </div>
                    <div className="w-full z-10 -bottom-14 h-20 absolute bg-white rounded-sq-xl"/>
                    <div style={{background:  chip.bg}} className="absolute w-full bottom-0 left-0 h-4"/>
                </div>

                {/* Body */}
                <div className="flex flex-col z-20 relative -mt-5 gap-3 px-3.5 py-3">
                    <div className={cn("flex gap-3", desc ? "items-start" : "items-center")}>
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full" style={{ backgroundColor: chip.bg, color: chip.fg }}>
                        <Icon size={20} />
                    </span>
                        <div className="min-w-0 flex-1">
                            <h3 className="truncate text-[14px] font-bold leading-snug tracking-[-0.005em] text-[color:var(--c-text)]">
                                {project.name}
                            </h3>
                            {desc && (
                                <p className="mt-0.5 truncate text-[12.5px] leading-5 text-[color:var(--c-text-muted)]">
                                    {desc}
                                </p>
                            )}
                        </div>
                    </div>

                    <FieldTable>
                        <FieldRow icon={<RepoMini />} label="Repo">
                            <span className="font-mono text-[11.5px]">{project.repo_full_name ?? project.repo_url}</span>
                        </FieldRow>
                        <FieldRow icon={<ClockIcon />} label="Updated">{shortDate(project.updated_at)}</FieldRow>
                    </FieldTable>

                    <div className="flex items-center justify-between gap-3">
                        <StatusFooter status={status} />
                        <span className="inline-flex shrink-0 items-center gap-1 text-[11.5px] tabular-nums text-[color:var(--c-text-dim)]">
                        <ClockIcon />
                            {timeAgo(project.updated_at)}
                    </span>
                    </div>
                </div>
            </motion.div>
        </Link>
    )
}

function StatusFooter({ status }: { status: ProjectStatus }) {
    if (status.kind === "progress") {
        return (
            <span className="flex items-center gap-2.5">
                <span className="text-[15px] font-extrabold tabular-nums tracking-[-0.01em]">
                    {status.done}
                    <span className="text-[color:var(--c-text-dim)]"> / {status.total}</span>
                </span>
                <SegBar value={status.done} total={status.total} max={10} />
            </span>
        )
    }
    if (status.kind === "clear") {
        return (
            <span className="inline-flex items-center gap-1.5 text-[12px] font-medium text-[color:var(--c-text-muted)]">
                <CheckCircleIcon />
                No issues at all
            </span>
        )
    }
    if (status.kind === "critical") {
        return (
            <span className="inline-flex items-center gap-1.5 text-[12px] font-medium text-[color:var(--c-text-muted)]">
                <span className="h-2 w-2 shrink-0 rounded-full bg-orange-500" />
                {status.count} critical issue{status.count > 1 ? "s" : ""} open
            </span>
        )
    }
    return (
        <span className="inline-flex items-center gap-1.5 text-[12px] font-medium text-[color:var(--c-text-muted)]">
            <PrIcon className="text-violet-500" />
            {status.count} PR{status.count > 1 ? "s" : ""} recently opened
        </span>
    )
}

// ── icons ────────────────────────────────────────────────────────────────
function RepoMini() {
    return (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M4 4h12a4 4 0 014 4v12H8a4 4 0 01-4-4V4z" />
            <path d="M4 16a4 4 0 014-4h12" />
        </svg>
    )
}
function ClockIcon() {
    return (
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
            <circle cx="12" cy="12" r="9" />
            <path d="M12 7v5l3 2" />
        </svg>
    )
}
function CheckCircleIcon() {
    return (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="text-emerald-500">
            <circle cx="12" cy="12" r="9" />
            <path d="M8.5 12.5l2.5 2.5 4.5-5" />
        </svg>
    )
}
function PrIcon({ className }: { className?: string }) {
    return (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden className={className}>
            <circle cx="6" cy="6" r="2.5" />
            <circle cx="6" cy="18" r="2.5" />
            <circle cx="18" cy="18" r="2.5" />
            <path d="M6 8.5v7M18 15.5V13a3 3 0 0 0-3-3H9" />
        </svg>
    )
}
