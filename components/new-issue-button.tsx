"use client"

import { useState } from "react"
import { Modal } from "@/components/modal"
import { IssueForm } from "@/components/issue-form"

export function NewIssueButton({ projectId }: { projectId: string }) {
    const [open, setOpen] = useState(false)
    return (
        <>
            <button onClick={() => setOpen(true)} className="btn-primary">
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
