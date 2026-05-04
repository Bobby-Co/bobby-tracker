"use client"

import { useState } from "react"
import { Modal } from "@/components/modal"
import { Dropdown } from "@/components/dropdown"
import { IssueForm } from "@/components/issue-form"

interface MemberInfo {
    id: string
    name: string
    analyser_ready: boolean
}

// "New issue" inside a group context. Two-step modal:
//   1. Pick which project the issue belongs to. Indexed-only —
//      filing into a non-ready project would 409 from the create
//      endpoint anyway, so we don't pretend it's an option here.
//   2. Render the regular IssueForm scoped to that project. On
//      success the form already refreshes + navigates to the new
//      issue's detail page.
//
// AI compose handles the routing case (one paragraph → fan out to
// the right project), so this button intentionally stays simple:
// pick a target, file directly. No fan-out.
export function GroupNewIssueButton({ members }: { members: MemberInfo[] }) {
    const [open, setOpen] = useState(false)
    const [projectId, setProjectId] = useState<string>("")

    const ready = members.filter((m) => m.analyser_ready)
    const disabled = ready.length === 0

    return (
        <>
            <button
                type="button"
                onClick={() => {
                    setProjectId("")
                    setOpen(true)
                }}
                disabled={disabled}
                title={disabled ? "Index at least one project in this group first." : undefined}
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
                title={projectId ? "New issue" : "Pick a project"}
                description={projectId
                    ? "Filing into the selected project. Status, priority, and labels can be edited later."
                    : "Group issues belong to one of the member projects. Pick one and we'll open its issue form."}
                size="lg"
            >
                {!projectId ? (
                    <div className="flex flex-col gap-3">
                        <Dropdown<string>
                            value={projectId}
                            onChange={(v) => setProjectId(v)}
                            options={ready.map((m) => ({ value: m.id, label: m.name }))}
                            placeholder="Choose a project…"
                            searchable={ready.length > 6}
                            aria-label="Project"
                        />
                        {members.length !== ready.length && (
                            <p className="rounded-[10px] bg-amber-50 px-3 py-2 text-[12px] text-amber-900">
                                {members.length - ready.length} project{members.length - ready.length === 1 ? "" : "s"} {members.length - ready.length === 1 ? "is" : "are"} missing from this list because the analyser hasn&apos;t finished its first index yet. Index them on each project&apos;s Knowledge tab to make them selectable here.
                            </p>
                        )}
                        <div className="mt-1 flex justify-end gap-2">
                            <button type="button" onClick={() => setOpen(false)} className="btn-ghost">
                                Cancel
                            </button>
                        </div>
                    </div>
                ) : (
                    <IssueForm
                        projectId={projectId}
                        onSuccess={() => setOpen(false)}
                        onCancel={() => setOpen(false)}
                    />
                )}
            </Modal>
        </>
    )
}
