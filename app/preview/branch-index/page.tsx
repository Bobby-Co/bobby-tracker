"use client"

import { useEffect, useState } from "react"
import { BranchIndexPanel } from "@/components/projects/branch-index-panel"
import type { ProjectBranch } from "@/lib/shared/types"

// The branch panel, every state, no network.
//
// The panel reads through useApi, so this stubs window.fetch rather than
// threading a test-only prop through production code. Same component the
// Knowledge page mounts; only the transport is fake.

const NOW = "2026-08-26T10:00:00Z"

function row(branch: string, status: ProjectBranch["status"], extra: Partial<ProjectBranch> = {}): ProjectBranch {
    return {
        id: `id-${branch}`,
        project_id: "p1",
        branch,
        status,
        graph_id: status === "ready" ? `abc123@branch/${branch}` : null,
        last_indexed_at: status === "ready" ? NOW : null,
        last_indexed_sha: status === "ready" ? "deadbeefcafe" : null,
        last_error: null,
        created_at: NOW,
        updated_at: NOW,
        ...extra,
    }
}

const SETS: Record<string, ProjectBranch[]> = {
    "Nothing tracked yet": [],
    "One ready branch": [row("feat/multi-branch", "ready")],
    "Every state": [
        row("feat/multi-branch", "ready"),
        row("develop", "indexing"),
        row("release/2.0", "pending"),
        row("feat/broken", "failed", {
            last_error: "repository has no graph yet — bootstrap it before indexing branches",
        }),
    ],
    "A long branch name": [
        row("feature/very-long-branch-name-that-should-truncate-rather-than-wrap-the-row", "ready"),
        row("main", "ready"),
    ],
}

export default function BranchIndexPreview() {
    const [set, setSet] = useState<keyof typeof SETS>("Every state")
    const [ready, setReady] = useState(false)

    useEffect(() => {
        const real = window.fetch
        window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
            const url = typeof input === "string" ? input : input.toString()
            if (url.includes("/branches")) {
                // Mutations just echo success; the list is whatever the picker says.
                if (init?.method && init.method !== "GET") {
                    return new Response(JSON.stringify({ status: "ok" }), {
                        status: 200,
                        headers: { "Content-Type": "application/json" },
                    })
                }
                return new Response(JSON.stringify({ branches: SETS[set] }), {
                    status: 200,
                    headers: { "Content-Type": "application/json" },
                })
            }
            return real(input, init)
        }
        setReady(true)
        return () => {
            window.fetch = real
        }
    }, [set])

    return (
        <div className="mx-auto flex max-w-[720px] flex-col gap-5 p-8">
            <header className="flex flex-col gap-1">
                <h1 className="text-[20px] font-bold">Indexed branches</h1>
                <p className="text-[13px] text-[color:var(--c-text-muted)]">
                    The panel the Knowledge page mounts, with a stubbed transport.
                </p>
            </header>

            <div className="flex flex-wrap gap-2">
                {Object.keys(SETS).map((k) => (
                    <button
                        key={k}
                        type="button"
                        onClick={() => setSet(k as keyof typeof SETS)}
                        className={
                            "cursor-pointer rounded-full border px-3 py-1 text-[12.5px] font-semibold " +
                            (k === set
                                ? "border-[color:var(--c-primary)] text-[color:var(--c-primary)]"
                                : "border-[color:var(--c-border)] text-[color:var(--c-text-muted)]")
                        }
                    >
                        {k}
                    </button>
                ))}
            </div>

            {ready && <BranchIndexPanel key={set} projectId="p1" />}
        </div>
    )
}
