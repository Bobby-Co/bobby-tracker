"use client"

import { useRouter } from "next/navigation"
import { useState, useTransition } from "react"
import { Modal } from "@/components/modal"
import { Spinner } from "@/components/spinner"
import { MultiDropdown } from "@/components/multi-dropdown"

interface ProjectOption {
    id: string
    name: string
}

// "New group" trigger + modal. Light create form (name + initial
// project picker); rename + member CRUD live on the detail page.
export function NewGroupButton({ projects }: { projects: ProjectOption[] }) {
    const router = useRouter()
    const [open, setOpen] = useState(false)
    const [name, setName] = useState("")
    const [picked, setPicked] = useState<string[]>([])
    const [error, setError] = useState<string | null>(null)
    const [pending, startTransition] = useTransition()

    function submit(e: React.FormEvent) {
        e.preventDefault()
        setError(null)
        startTransition(async () => {
            const res = await fetch("/api/groups", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name, project_ids: picked }),
            })
            if (!res.ok) {
                const e = await res.json().catch(() => ({}))
                setError(e?.error?.message || `Failed (${res.status})`)
                return
            }
            const { group } = await res.json()
            setOpen(false)
            setName("")
            setPicked([])
            router.refresh()
            if (group?.id) router.push(`/groups/${group.id}`)
        })
    }

    return (
        <>
            <button onClick={() => setOpen(true)} className="btn-primary">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden>
                    <path d="M12 5v14M5 12h14" />
                </svg>
                New group
            </button>
            <Modal
                open={open}
                onClose={() => !pending && setOpen(false)}
                title="New project group"
                description="Pick the projects this group covers. The AI router will choose between them when you compose a group-aware issue."
                size="lg"
            >
                <form onSubmit={submit} className="flex flex-col gap-3">
                    <fieldset disabled={pending} className="contents">
                        <label className="flex flex-col gap-1">
                            <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-[color:var(--c-text-muted)]">
                                Name
                            </span>
                            <input
                                autoFocus
                                required
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                placeholder="e.g. Bobby suite"
                                className="input text-[14px] font-semibold"
                            />
                        </label>

                        <div className="flex flex-col gap-1">
                            <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-[color:var(--c-text-muted)]">
                                Projects
                            </span>
                            {projects.length === 0 ? (
                                <p className="rounded-[10px] bg-[color:var(--c-surface-2)] px-3 py-2 text-[12.5px] text-[color:var(--c-text-muted)]">
                                    You don&apos;t have any projects yet — create one before grouping.
                                </p>
                            ) : (
                                <MultiDropdown<string>
                                    values={picked}
                                    onChange={setPicked}
                                    options={projects.map((p) => ({ value: p.id, label: p.name }))}
                                    placeholder="Add projects…"
                                    searchable={projects.length > 6}
                                    aria-label="Projects in group"
                                />
                            )}
                        </div>
                    </fieldset>

                    {error && (
                        <p role="alert" className="rounded-[10px] bg-rose-50 px-3 py-2 text-[12.5px] text-rose-800">
                            {error}
                        </p>
                    )}

                    <div className="mt-1 flex justify-end gap-2">
                        <button type="button" onClick={() => setOpen(false)} className="btn-ghost" disabled={pending}>
                            Cancel
                        </button>
                        <button type="submit" disabled={pending || !name.trim()} className="btn-primary">
                            {pending ? (<><Spinner />Creating…</>) : "Create group"}
                        </button>
                    </div>
                </form>
            </Modal>
        </>
    )
}
