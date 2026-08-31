"use client"

// Dev-only preview of the PLAYFUL sticker-board planning view with mock
// data. A softer, more colourful reimagining of /preview/timeline. Not
// linked from anywhere; safe to delete.

import { useState } from "react"
import { TimelineGridPlayful, tileCols } from "@/components/timeline/timeline-grid-playful"
import { rowToLaneAbs } from "@/lib/client/timeline/grid"
import type {
    Issue,
    IssueStatus,
    IssuePriority,
    ProjectLabelIcon,
} from "@/lib/shared/types"

const DAY = 24 * 60 * 60 * 1000

function midnight(offsetDays: number): string {
    const d = new Date()
    d.setHours(0, 0, 0, 0)
    d.setDate(d.getDate() + offsetDays)
    return d.toISOString()
}

// A tiny inline-SVG thumbnail as a data URI, so the preview's image
// tiles render offline (no network / real attachments needed).
function shot(bg: string, fg: string): string {
    const svg =
        `<svg xmlns='http://www.w3.org/2000/svg' width='120' height='84'>` +
        `<rect width='120' height='84' fill='${bg}'/>` +
        `<circle cx='34' cy='30' r='15' fill='${fg}' opacity='0.9'/>` +
        `<rect x='16' y='54' width='88' height='9' rx='4.5' fill='${fg}' opacity='0.55'/>` +
        `<rect x='16' y='69' width='56' height='7' rx='3.5' fill='${fg}' opacity='0.32'/>` +
        `</svg>`
    return `data:image/svg+xml,${encodeURIComponent(svg)}`
}

// Label → Iconly glyph. Each issue carries one label; the board looks
// it up via the labelIcons prop to draw the tile's chip icon.
const LABELS: { label: string; icon: string }[] = [
    { label: "frontend", icon: "code" },
    { label: "backend", icon: "database" },
    { label: "design", icon: "camera" },
    { label: "bug", icon: "danger" },
    { label: "auth", icon: "check-badge" },
    { label: "api", icon: "cloud-connect" },
    { label: "ai", icon: "bot" },
    { label: "docs", icon: "book" },
    { label: "billing", icon: "bank-card" },
    { label: "infra", icon: "building" },
    { label: "mobile", icon: "call" },
    { label: "analytics", icon: "chart-circle" },
    { label: "chat", icon: "chat" },
    { label: "payments", icon: "coins-1" },
    { label: "data", icon: "category" },
    { label: "calendar", icon: "calendar" },
]

let n = 0
function mk(
    title: string,
    status: IssueStatus,
    priority: IssuePriority,
    opts: { startDay?: number; days?: number; lane?: number; label?: string; body?: string } = {},
): Issue {
    n += 1
    const scheduled = opts.startDay !== undefined
    return {
        id: `mock-${n}`,
        project_id: "preview",
        user_id: "preview",
        title,
        body: opts.body ?? "",
        status,
        priority,
        labels: opts.label ? [opts.label] : [],
        github_issue_number: null,
        github_node_id: null,
        sync_source: null,
        last_synced_hash: null,
        github_synced_at: null,
        github_analysis_comment_id: null,
        analysis_status: null,
        issue_number: 100 + n,
        ai_proposed: false,
        duplicate_of_issue_id: null,
        starts_at: scheduled ? midnight(opts.startDay!) : null,
        ends_at: scheduled ? midnight(opts.startDay! + (opts.days ?? 1)) : null,
        lane_y: scheduled ? rowToLaneAbs(opts.lane ?? 0) : null,
        color: null,
        analyse_effort: null,
        branch: null,
        created_at: new Date(Date.now() - DAY).toISOString(),
        updated_at: new Date().toISOString(),
    }
}

// A scheduled issue before it's been assigned a lane. `days` is its
// width in columns, `span` its height in lanes (2+ shows a description,
// 3 also shows image thumbnails).
interface Spec {
    title: string
    status: IssueStatus
    priority: IssuePriority
    label: string
    startDay: number
    days: number
    span?: number
    body?: string
}

// The scheduled workload — spread across ~30 days and every status /
// priority. Two carry rich bodies + images so the tall tiles show off.
const SCHEDULED: Spec[] = [
    {
        title: "Design LEGO baseplate", label: "design", status: "in_progress", priority: "high",
        startDay: 0, days: 4, span: 3,
        body:
            "Square baseplate where columns are days and rows are lanes. Bricks snap to whole cells and never overlap. " +
            `![grid](${shot("#0f172a", "#38bdf8")}) ![lanes](${shot("#1e293b", "#a78bfa")}) ![studs](${shot("#312e81", "#f0abfc")})`,
    },
    { title: "Fix drag jitter on Safari", label: "bug", status: "open", priority: "urgent", startDay: 0, days: 1 },
    { title: "Snap resize to whole days", label: "frontend", status: "open", priority: "medium", startDay: 1, days: 2 },
    { title: "Outbox flush retry policy", label: "backend", status: "in_progress", priority: "high", startDay: 2, days: 3 },
    { title: "Rate-limit the schedule API", label: "api", status: "blocked", priority: "high", startDay: 3, days: 2 },
    { title: "SSO / passkey login", label: "auth", status: "open", priority: "medium", startDay: 4, days: 3 },
    {
        title: "AI issue summariser", label: "ai", status: "in_progress", priority: "high",
        startDay: 5, days: 3, span: 2,
        body: "Summarise long issue threads into a two-line brief and suggest the next action. Runs on Workers AI with a fallback model.",
    },
    { title: "Write timeline docs", label: "docs", status: "done", priority: "low", startDay: 6, days: 1 },
    { title: "Stripe usage billing", label: "billing", status: "open", priority: "medium", startDay: 8, days: 3 },
    { title: "Terraform the edge stack", label: "infra", status: "blocked", priority: "urgent", startDay: 9, days: 2 },
    { title: "iOS push notifications", label: "mobile", status: "in_progress", priority: "high", startDay: 11, days: 4 },
    { title: "Funnel analytics board", label: "analytics", status: "open", priority: "medium", startDay: 13, days: 2 },
    { title: "Realtime chat presence", label: "chat", status: "open", priority: "low", startDay: 14, days: 3 },
    { title: "Refund webhook handler", label: "payments", status: "done", priority: "medium", startDay: 16, days: 2 },
    {
        title: "Vectorise issue embeddings", label: "data", status: "in_progress", priority: "high",
        startDay: 17, days: 5, span: 2,
        body:
            "Backfill embeddings for every issue so similar-report detection works at scale. Batched through the queue. " +
            `![vectors](${shot("#052e2b", "#2dd4bf")}) ![index](${shot("#1e1b4b", "#818cf8")})`,
    },
    { title: "Sprint calendar sync", label: "calendar", status: "open", priority: "low", startDay: 19, days: 2 },
    { title: "Legacy import cleanup", label: "frontend", status: "archived", priority: "low", startDay: 22, days: 3 },
    { title: "Dedup duplicate reports", label: "backend", status: "duplicated", priority: "medium", startDay: 25, days: 2 },
    { title: "Crash on empty board", label: "bug", status: "open", priority: "urgent", startDay: 27, days: 3 },
    { title: "Polish empty states", label: "design", status: "done", priority: "low", startDay: 29, days: 2 },
]

// The unscheduled backlog — shows in the floating tray, ready to drag
// onto the board.
const TRAY: Spec[] = [
    { title: "Dark mode audit", label: "design", status: "open", priority: "medium", startDay: -1, days: 1 },
    { title: "Keyboard shortcuts", label: "frontend", status: "open", priority: "low", startDay: -1, days: 1 },
    { title: "Audit log export", label: "backend", status: "open", priority: "high", startDay: -1, days: 1 },
    { title: "Onboarding checklist", label: "docs", status: "open", priority: "medium", startDay: -1, days: 1 },
    { title: "Webhook signing", label: "api", status: "open", priority: "high", startDay: -1, days: 1 },
    { title: "Locale / i18n pass", label: "frontend", status: "open", priority: "low", startDay: -1, days: 1 },
]

const LANES = 11 // reference lane count for the packer (see below)

// Greedily assign each scheduled spec the lowest free lane whose
// [startDay, startDay+days) × [lane, lane+span) region is unoccupied,
// so nothing overlaps on load. Lanes map to the stored fractional
// lane_y; the board re-derives rows from viewport height at runtime.
function packLanes(specs: Spec[]): (Spec & { lane: number })[] {
    const occ = new Set<string>()
    return specs.map((s) => {
        const span = s.span ?? 1
        // Reserve the same footprint the board renders, so tiles don't
        // overlap once their readable width is applied.
        const width = tileCols(s.days)
        let lane = 0
        for (; lane + span <= LANES; lane++) {
            let free = true
            for (let dc = 0; dc < width && free; dc++)
                for (let dl = 0; dl < span && free; dl++)
                    if (occ.has(`${lane + dl}:${s.startDay + dc}`)) free = false
            if (free) break
        }
        if (lane + span > LANES) lane = 0
        for (let dc = 0; dc < width; dc++)
            for (let dl = 0; dl < span; dl++)
                occ.add(`${lane + dl}:${s.startDay + dc}`)
        // Absolute integer lane row; mk() encodes it into the stored
        // lane_y fraction the board decodes back (see rowToLaneAbs).
        return { ...s, lane }
    })
}

function buildMockData() {
    n = 0
    const initialTileRows: Record<string, number> = {}
    const scheduled = packLanes(SCHEDULED).map((s) => {
        const issue = mk(s.title, s.status, s.priority, {
            startDay: s.startDay, days: s.days, lane: s.lane, label: s.label, body: s.body,
        })
        if (s.span && s.span > 1) initialTileRows[issue.id] = s.span
        return issue
    })
    const tray = TRAY.map((s) => mk(s.title, s.status, s.priority, { label: s.label }))
    const labelIcons: ProjectLabelIcon[] = LABELS.map((l) => ({
        project_id: "preview",
        label: l.label,
        icon_name: l.icon,
        color: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
    }))
    return { issues: [...scheduled, ...tray], labelIcons, initialTileRows }
}

export default function PreviewTimeline() {
    const [{ issues, labelIcons, initialTileRows }] = useState(buildMockData)
    const [openIssue, setOpenIssue] = useState<Issue | null>(null)

    return (
        <div className="fixed inset-0 flex flex-col bg-[color:var(--c-shell)]">
            {/* Playful floating title chip. */}
            <div className="pointer-events-none absolute left-5 top-4 z-40 flex items-center gap-2 rounded-full bg-[color:var(--c-surface)]/95 py-1.5 pl-2 pr-3.5 shadow-[var(--shadow-pop)] ring-1 ring-[color:var(--c-border)]">
                <span className="grid h-6 w-6 place-items-center rounded-full bg-[color:var(--c-primary)] text-[13px]">🗓️</span>
                <span className="text-[13px] font-extrabold tracking-[-0.01em] text-[color:var(--c-text)]">Planner</span>
                <span className="rounded-full bg-[color:var(--c-primary-tint)] px-2 py-0.5 text-[9px] font-extrabold uppercase tracking-[0.08em] text-[color:var(--c-accent)]">Playful</span>
            </div>
            <TimelineGridPlayful
                projectId="preview"
                issues={issues}
                labelIcons={labelIcons}
                statusColors={[]}
                onTileClick={setOpenIssue}
                // Mock issues have no rows behind them, so a drag here must
                // not try to PATCH them — every write would come back 4xx
                // and the board would (rightly) report it couldn't save.
                persist={false}
                // Open with the rich tiles pre-expanded so the tiered
                // content is visible without dragging first.
                initialTileRows={initialTileRows}
            />

            {/* Issue description panel — opens when a tile is clicked. In
                the real app this is the IssueDrawer. */}
            {openIssue && (
                <>
                    <div className="fixed inset-0 z-40 bg-black/20" onClick={() => setOpenIssue(null)} />
                    <aside className="fixed right-0 top-0 z-50 flex h-full w-[380px] max-w-[86vw] flex-col gap-4 border-l border-[color:var(--c-border)] bg-[color:var(--c-surface)] p-5 shadow-[var(--shadow-pop)]">
                        <div className="flex items-start justify-between gap-3">
                            <div>
                                <div className="text-[10.5px] font-bold uppercase tracking-[0.14em] text-[color:var(--c-text-muted)]">
                                    Issue #{openIssue.issue_number}
                                </div>
                                <h2 className="mt-0.5 text-[16px] font-bold tracking-[-0.01em]">{openIssue.title}</h2>
                            </div>
                            <button
                                type="button"
                                onClick={() => setOpenIssue(null)}
                                className="grid h-8 w-8 shrink-0 place-items-center rounded-[10px] border border-[color:var(--c-border)] text-[color:var(--c-text-muted)] hover:bg-[color:var(--c-overlay)]"
                                aria-label="Close"
                            >
                                ✕
                            </button>
                        </div>
                        <div className="flex flex-wrap gap-2 text-[11.5px] font-semibold">
                            <span className="rounded-full bg-[color:var(--c-surface-2)] px-2.5 py-1 capitalize">{openIssue.status.replace("_", " ")}</span>
                            <span className="rounded-full bg-[color:var(--c-surface-2)] px-2.5 py-1 capitalize">{openIssue.priority}</span>
                            {openIssue.labels[0] && (
                                <span className="rounded-full bg-[color:var(--c-surface-2)] px-2.5 py-1">{openIssue.labels[0]}</span>
                            )}
                        </div>
                        <p className="text-[13px] leading-relaxed text-[color:var(--c-text-muted)]">
                            {openIssue.body || "No description yet. This is where the issue description would render."}
                        </p>
                    </aside>
                </>
            )}
        </div>
    )
}
