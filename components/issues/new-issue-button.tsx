"use client"

import { useIssueComposer } from "@/components/issues/issue-composer"

export function NewIssueButton({
    projectId,
    disabled,
    disabledReason,
}: {
    projectId: string
    /** Disable the trigger when the project's analyser isn't ready —
     * issues need a graph to be useful (suggestions cite specific
     * files/lines from it), so creating them before the first index
     * just produces low-value rows. */
    disabled?: boolean
    /** Tooltip + a11y description for the disabled state. */
    disabledReason?: string
}) {
    // Opens the docked composer panel (app-shell renders it once). No modal —
    // creating an issue is the main act, so it gets a first-class surface that
    // pushes the page rather than dimming it. See issue-composer.tsx.
    const { startDraft, expanded, openProjectId } = useIssueComposer()
    const isOpen = expanded && openProjectId === projectId

    return (
        <button
            onClick={() => startDraft(projectId)}
            disabled={disabled}
            title={disabled ? disabledReason : undefined}
            aria-disabled={disabled}
            aria-expanded={isOpen}
            className="btn-primary disabled:cursor-not-allowed disabled:opacity-50"
        >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden>
                <path d="M12 5v14M5 12h14" />
            </svg>
            New issue
        </button>
    )
}
