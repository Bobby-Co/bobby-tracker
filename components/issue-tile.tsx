import Link from "next/link"
import { cn } from "@/components/cn"
import { MiniCard, FieldTable, FieldRow } from "@/components/field-card"
import {
    STATUS_META,
    StatusGlyph,
    StatusValue,
    PriorityValue,
    shortDate,
    timeAgo,
} from "@/components/issue-meta"
import type { Issue } from "@/lib/supabase/types"

// Minimal field-table issue card (reference style): a status-tinted
// circular glyph + title + #number, a calm three-row field table
// (Priority / Status / Created), and a quiet footer (labels · updated).
export function IssueTile({
    issue,
    projectId,
    index,
    interactive = true,
}: {
    issue: Issue
    projectId: string
    index?: number
    interactive?: boolean
}) {
    const meta = STATUS_META[issue.status]
    const labels = issue.labels.slice(0, 1)
    const moreLabels = Math.max(0, issue.labels.length - labels.length)

    return (
        <Link
            href={`/projects/${projectId}/issues/${issue.id}`}
            prefetch={false}
            className="group block anim-rise focus:outline-none"
            tabIndex={0}
            style={index != null ? ({ ["--i" as string]: index } as React.CSSProperties) : undefined}
        >
            <MiniCard
                interactive={interactive}
                tone={meta.tone}
                icon={<StatusGlyph status={issue.status} />}
                title={issue.title}
                subtitle={`#${issue.issue_number}`}
                badge={issue.ai_proposed ? <AiBadge /> : undefined}
                footer={
                    <>
                        {labels.length > 0 ? (
                            <span className="inline-flex items-center gap-1.5">
                                <span className="chip-min max-w-[150px] truncate">{labels[0]}</span>
                                {moreLabels > 0 && (
                                    <span className="text-[11px] text-[color:var(--c-text-dim)]">+{moreLabels}</span>
                                )}
                            </span>
                        ) : (
                            <span />
                        )}
                        <span className="ml-auto inline-flex items-center gap-1">
                            <ClockIcon />
                            {timeAgo(issue.updated_at)}
                        </span>
                    </>
                }
            >
                <FieldTable>
                    <FieldRow icon={<FlagIcon />} label="Priority">
                        <PriorityValue priority={issue.priority} />
                    </FieldRow>
                    <FieldRow icon={<CircleIcon />} label="Status">
                        <StatusValue status={issue.status} />
                    </FieldRow>
                    <FieldRow icon={<CalendarIcon />} label="Created">
                        {shortDate(issue.created_at)}
                    </FieldRow>
                </FieldTable>
            </MiniCard>
        </Link>
    )
}

function AiBadge() {
    return (
        <span className={cn("shrink-0 rounded-full bg-indigo-50 px-1.5 py-[1px] text-[9.5px] font-bold uppercase tracking-[0.06em] text-indigo-600")}>
            AI
        </span>
    )
}

// ── inline icons ────────────────────────────────────────────────────────
function FlagIcon() {
    return (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M4 21V4M4 4h12l-2 4 2 4H4" />
        </svg>
    )
}
function CircleIcon() {
    return (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
            <circle cx="12" cy="12" r="8" />
        </svg>
    )
}
function CalendarIcon() {
    return (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <rect x="3" y="5" width="18" height="16" rx="2" />
            <path d="M3 9h18M8 3v4M16 3v4" />
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
