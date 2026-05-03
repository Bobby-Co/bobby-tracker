"use client"

import { useRouter } from "next/navigation"
import { useState, useTransition } from "react"
import { Modal } from "@/components/modal"
import { Spinner } from "@/components/spinner"

interface ProjectOption {
    id: string
    name: string
}

// "New session" trigger + modal. Keeps the create form light: just
// name + initial project list. The full window/title/description
// editor lives on the session detail page so users aren't fighting
// a tall modal up front.
export function NewSessionButton({ projects }: { projects: ProjectOption[] }) {
    const router = useRouter()
    const [open, setOpen] = useState(false)
    const [name, setName] = useState("")
    const [picked, setPicked] = useState<Set<string>>(new Set())
    const [error, setError] = useState<string | null>(null)
    const [pending, startTransition] = useTransition()

    function toggle(id: string) {
        setPicked((prev) => {
            const next = new Set(prev)
            if (next.has(id)) next.delete(id)
            else next.add(id)
            return next
        })
    }

    function submit(e: React.FormEvent) {
        e.preventDefault()
        setError(null)
        startTransition(async () => {
            const res = await fetch("/api/sessions", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    name,
                    project_ids: Array.from(picked),
                }),
            })
            if (!res.ok) {
                const e = await res.json().catch(() => ({}))
                setError(e?.error?.message || `Failed (${res.status})`)
                return
            }
            const { session } = await res.json()
            setOpen(false)
            setName("")
            setPicked(new Set())
            router.refresh()
            if (session?.id) router.push(`/sessions/${session.id}`)
        })
    }

    return (
        <>
            <button onClick={() => setOpen(true)} className="btn-primary">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden>
                    <path d="M12 5v14M5 12h14" />
                </svg>
                New session
            </button>
            <Modal
                open={open}
                onClose={() => !pending && setOpen(false)}
                title="New public session"
                description="Pick which projects this link will accept submissions for. You can edit everything else afterwards."
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
                                placeholder="e.g. Beta feedback Q2"
                                className="input text-[14px] font-semibold"
                            />
                        </label>

                        <div className="flex flex-col gap-1">
                            <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-[color:var(--c-text-muted)]">
                                Projects
                            </span>
                            {projects.length === 0 ? (
                                <p className="rounded-[10px] bg-[color:var(--c-surface-2)] px-3 py-2 text-[12.5px] text-[color:var(--c-text-muted)]">
                                    Create a project first.
                                </p>
                            ) : (
                                <ul className="max-h-56 overflow-auto rounded-[10px] border border-[color:var(--c-border)]">
                                    {projects.map((p) => {
                                        const checked = picked.has(p.id)
                                        return (
                                            <li key={p.id}>
                                                <label className="flex cursor-pointer items-center gap-2 px-3 py-2 text-[13px] hover:bg-[color:var(--c-surface-2)]">
                                                    <input
                                                        type="checkbox"
                                                        checked={checked}
                                                        onChange={() => toggle(p.id)}
                                                        className="h-4 w-4 accent-zinc-900"
                                                    />
                                                    <span className="truncate">{p.name}</span>
                                                </label>
                                            </li>
                                        )
                                    })}
                                </ul>
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
                            {pending ? (<><Spinner />Creating…</>) : "Create session"}
                        </button>
                    </div>
                </form>
            </Modal>
        </>
    )
}
