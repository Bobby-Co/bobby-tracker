"use client"

import { useState } from "react"
import { Modal } from "@/components/modal"
import { ProjectForm } from "@/components/project-form"

export function NewProjectButton() {
    const [open, setOpen] = useState(false)
    return (
        <>
            <button onClick={() => setOpen(true)} className="btn-primary">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden>
                    <path d="M12 5v14M5 12h14" />
                </svg>
                New project
            </button>
            <Modal
                open={open}
                onClose={() => setOpen(false)}
                title="Create a project"
                description="Connect a Git repo and start filing issues."
            >
                <ProjectForm />
            </Modal>
        </>
    )
}
