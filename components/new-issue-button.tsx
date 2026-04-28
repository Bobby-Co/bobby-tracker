"use client"

import { useState } from "react"
import { Modal } from "@/components/modal"
import { IssueForm } from "@/components/issue-form"

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
    const [open, setOpen] = useState(false)
    return (
        <>
            <button
                onClick={() => setOpen(true)}
                disabled={disabled}
                title={disabled ? disabledReason : undefined}
                aria-disabled={disabled}
                className="btn-primary disabled:cursor-not-allowed disabled:opacity-50"
            >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden>
                    <path d="M12 5v14M5 12h14" />
                </svg>
                New issue
            </button>
            <Modal
                open={open}
                onClose={() => setOpen(false)}
                title="New issue"
                description="Title is required. Status, priority, and labels can be edited later."
                size="lg"
            >
                <IssueForm
                    projectId={projectId}
                    onSuccess={() => setOpen(false)}
                    onCancel={() => setOpen(false)}
                />
            </Modal>
        </>
    )
}
