"use client"

import { useEffect, useState } from "react"
import { motion } from "framer-motion"
import { ProjectTile, projectOrg } from "@/components/projects/project-tile"
import type { ProjectWithInsight } from "@/lib/shared/types"

// The projects grid, grouped by organisation (repo owner) with each org
// collapsible.
//
// NOT to be confused with the "Groups" strip above it on the same page: those
// are user-authored ProjectGroup bundles (a real table, used for AI routing).
// This is derived, not authored — it's purely how the grid arranges itself, adds
// no entity, and needs no schema. Both can be true at once: a project belongs to
// exactly one org, and to any number of groups.
//
// The org identity and its colour come from projectOrg() — the same function the
// tile uses for its header tint, so a group header always matches the tiles under
// it.

// Holds the OPEN orgs now (default is all-collapsed), so a fresh key: the old
// "collapsed-orgs" value carried the opposite meaning and must not be read back
// as an open-set.
const STORAGE_KEY = "projects:open-orgs"

type Org = {
    key: string
    name: string
    chip: { bg: string; fg: string }
    projects: ProjectWithInsight[]
}

/** Group by org, preserving the API's ordering (projects arrive newest-activity
 *  first), so the most recently active org floats to the top and the grid keeps
 *  the same rhythm it had before grouping. Alphabetical would be tidier and
 *  worse — it would bury whatever you were just working on. */
function groupByOrg(projects: ProjectWithInsight[]): Org[] {
    const orgs = new Map<string, Org>()
    for (const p of projects) {
        const { key, name, chip } = projectOrg(p)
        const existing = orgs.get(key)
        if (existing) existing.projects.push(p)
        else orgs.set(key, { key, name, chip, projects: [p] })
    }
    return [...orgs.values()]
}

export function ProjectOrgGrid({ projects }: { projects: ProjectWithInsight[] }) {
    const orgs = groupByOrg(projects)
    // Default is all-collapsed: the page opens as a light list of org headers and
    // mounts a section's (SVG-mask-heavy) tiles only when it's expanded. The set
    // holds the OPEN orgs — empty means everything closed.
    const [open, setOpen] = useState<Set<string>>(new Set())

    // Restore the previously-open orgs in an effect, not in useState's
    // initialiser: this component is server-rendered before it hydrates, and
    // localStorage doesn't exist there — seeding from it would make the server and
    // client markup disagree. The cost is that a restored-open org spends one
    // frame collapsed before it expands — the cheaper of the two problems, and
    // cheaper still now that a collapsed section renders no tiles at all.
    //
    // setState-in-effect is the correct pattern here for the same reason
    // mobile-sidebar.tsx suppresses this rule: localStorage IS the external
    // system we're synchronising from, which is exactly what effects are for.
    useEffect(() => {
        try {
            const raw = window.localStorage.getItem(STORAGE_KEY)
            // eslint-disable-next-line react-hooks/set-state-in-effect -- see above
            if (raw) setOpen(new Set(JSON.parse(raw) as string[]))
        } catch {
            // Private mode / corrupt value — start fully collapsed.
        }
    }, [])

    const toggle = (key: string) => {
        setOpen((prev) => {
            const next = new Set(prev)
            if (next.has(key)) next.delete(key)
            else next.add(key)
            try {
                window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...next]))
            } catch {
                // Persistence is a convenience; the toggle still works without it.
            }
            return next
        })
    }

    return (
        <div className="flex flex-col gap-5">
            {orgs.map((org) => (
                <OrgSection
                    key={org.key}
                    org={org}
                    open={open.has(org.key)}
                    onToggle={() => toggle(org.key)}
                />
            ))}
        </div>
    )
}

function OrgSection({ org, open, onToggle }: { org: Org; open: boolean; onToggle: () => void }) {
    // The tiles lift on hover (whileHover y:-3) and carry a shadow, so a
    // permanently-clipped container would shear the top off a hovered tile in the
    // first row. Clip only while the height is actually animating — the same trap
    // the topbar's overflow-hidden set for the notification popover.
    const [animating, setAnimating] = useState(false)

    // Lazy-mount: the tiles are graphic-heavy (hyperellipse squircle masks + a
    // per-tile motion layer), so we don't render them until the section is first
    // opened. Once mounted we keep them — re-expanding is then instant, and a
    // section the user never opens never pays the cost. With the grid defaulting
    // to all-collapsed, the first paint therefore mounts zero tiles.
    const [mounted, setMounted] = useState(open)
    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- mount tiles on first open; see above
        if (open && !mounted) setMounted(true)
    }, [open, mounted])

    return (
        <section>
            <button
                type="button"
                onClick={onToggle}
                aria-expanded={open}
                className="group mb-2.5 flex w-full items-center gap-2 rounded-[8px] py-1 text-left transition-colors"
            >
                <Chevron open={open} />
                {/* Same tint as every tile in this section — projectOrg() is the
                    single source for both. */}
                <span
                    className="h-4 w-4 shrink-0 rounded-full ring-2"
                    style={{ backgroundColor: org.chip.fg, ["--tw-ring-color" as string]: org.chip.bg }}
                />
                <span className="min-w-0 truncate text-[13.5px] font-bold tracking-[-0.01em] text-[color:var(--c-text)]">
                    {org.name}
                </span>
                <span className="rounded-full bg-[color:var(--c-surface-2)] px-1.5 py-0.5 text-[10.5px] font-bold tabular-nums text-[color:var(--c-text-muted)]">
                    {org.projects.length}
                </span>
                {/* A hairline that eats the remaining width — gives each org a spine
                    to sit on without drawing a heavy divider. */}
                <span aria-hidden className="ml-1 h-px flex-1 bg-[color:var(--c-border)]" />
            </button>

            <motion.div
                initial={false}
                animate={{ height: open ? "auto" : 0, opacity: open ? 1 : 0 }}
                onAnimationStart={() => setAnimating(true)}
                onAnimationComplete={() => setAnimating(false)}
                transition={{
                    height: { type: "spring", stiffness: 380, damping: 34, mass: 0.7 },
                    opacity: { duration: open ? 0.2 : 0.12, ease: "easeOut" },
                }}
                style={{ overflow: open && !animating ? "visible" : "hidden" }}
            >
                {mounted && (
                    <ul
                        className="grid gap-4"
                        style={{ gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))" }}
                    >
                        {org.projects.map((p) => (
                            <li key={p.id}>
                                <ProjectTile project={p} insight={p.insight} minimal />
                            </li>
                        ))}
                    </ul>
                )}
            </motion.div>
        </section>
    )
}

function Chevron({ open }: { open: boolean }) {
    return (
        <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
            className="shrink-0 text-[color:var(--c-text-dim)] transition-transform duration-200 group-hover:text-[color:var(--c-text)]"
            style={{ transform: open ? "rotate(90deg)" : "rotate(0deg)" }}
        >
            <path d="M9 6l6 6-6 6" />
        </svg>
    )
}
