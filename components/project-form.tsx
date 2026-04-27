"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"

export function ProjectForm() {
    const [name, setName] = useState("")
    const [repoUrl, setRepoUrl] = useState("")
    const [description, setDescription] = useState("")
    const [error, setError] = useState<string | null>(null)
    const [pending, startTransition] = useTransition()
    const router = useRouter()

    function submit(e: React.FormEvent) {
        e.preventDefault()
        setError(null)
        startTransition(async () => {
            const res = await fetch("/api/projects", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name, repo_url: repoUrl, description }),
            })
            if (!res.ok) {
                const body = await res.json().catch(() => ({}))
                setError(body?.error?.message || `Failed (${res.status})`)
                return
            }
            const { project } = await res.json()
            router.push(`/projects/${project.id}/issues`)
            router.refresh()
        })
    }

    return (
        <form onSubmit={submit} className="flex flex-col gap-3">
            <Field label="Project name">
                <input
                    autoFocus
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="bobby-analyser"
                    className="input"
                />
            </Field>
            <Field label="Git repository URL">
                <input
                    required
                    type="url"
                    value={repoUrl}
                    onChange={(e) => setRepoUrl(e.target.value)}
                    placeholder="https://github.com/you/repo"
                    className="input"
                />
            </Field>
            <Field label="Description (optional)">
                <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    rows={2}
                    placeholder="One-liner about what this tracks"
                    className="input"
                />
            </Field>
            {error && <p className="text-[12.5px] text-rose-700">{error}</p>}
            <div className="flex justify-end gap-2 pt-1">
                <button type="submit" disabled={pending} className="btn-primary">
                    {pending ? "Creating…" : "Create project"}
                </button>
            </div>
        </form>
    )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <label className="flex flex-col gap-1">
            <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-[color:var(--c-text-muted)]">
                {label}
            </span>
            {children}
        </label>
    )
}
