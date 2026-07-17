"use client"

import Link from "next/link"
import { useParams } from "next/navigation"
import { GithubSyncPanel } from "@/components/projects/github-sync-panel"
import { AutoUpdatePanel } from "@/components/projects/auto-update-panel"
import { AnalyserDefaultEffort } from "@/components/projects/analyser-default-effort"
import { DangerZonePanel } from "@/components/projects/danger-zone-panel"

// Project setup — the first stop after a project is created, and the home for
// per-project configuration thereafter. Each concern is a self-contained panel;
// this page just stacks them, so adding a future setting is one more panel in
// the card-stack below.
export default function SetupPage() {
    const { id } = useParams<{ id: string }>()

    return (
        <div className="flex flex-col gap-4">
            <header>
                <h2 className="h-section">Setup</h2>
                <p className="mt-1 text-[13px] text-[color:var(--c-text-muted)]">
                    Connect GitHub, choose how this project stays in sync with your repo, and tune the
                    analyser. You can change any of this later from this tab.
                </p>
            </header>

            <div className="card-stack flex flex-col gap-4">
                {/* 1. GitHub — install the App + two-way issue/PR sync. */}
                <GithubSyncPanel projectId={id} />

                {/* 2. Keep the knowledge graph current on every push. */}
                <AutoUpdatePanel projectId={id} />

                {/* 3. How thoroughly the analyser investigates issues (default medium). */}
                <AnalyserDefaultEffort projectId={id} />
            </div>

            <div className="flex justify-end pt-1">
                <Link href={`/projects/${id}/issues`} className="btn-primary">
                    Continue to project →
                </Link>
            </div>

            {/* Danger zone — set apart from the config panels above. */}
            <div className="mt-6 border-t border-[color:var(--c-border)] pt-6">
                <h3 className="h-section text-rose-700">Danger zone</h3>
                <p className="mt-1 mb-3 text-[13px] text-[color:var(--c-text-muted)]">
                    Irreversible actions. Double-check before you proceed.
                </p>
                <DangerZonePanel projectId={id} />
            </div>
        </div>
    )
}
