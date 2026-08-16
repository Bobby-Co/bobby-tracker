"use client"

import { useParams } from "next/navigation"
import { DangerZonePanel } from "@/components/projects/danger-zone-panel"
import { DuplicateSensitivityPanel } from "@/components/projects/duplicate-sensitivity-panel"
import { ProjectIdentityPanel } from "@/components/projects/project-identity-panel"
import { ProjectPlacementPanel } from "@/components/projects/project-placement-panel"

// Project settings. Most per-project configuration lives with the thing it
// controls — GitHub sync on Integrations, indexing + auto-update + effort on
// Knowledge. What's left here is identity (name + icon) and the destructive
// stuff: deleting the project.
export default function SettingsPage() {
    const { id } = useParams<{ id: string }>()

    return (
        <div className="flex flex-col gap-8">
            <section className="flex flex-col gap-4">
                <header>
                    <h2 className="h-section">General</h2>
                    <p className="mt-1 text-[13px] text-[color:var(--c-text-muted)]">
                        The name and icon shown for this project across the app.
                    </p>
                </header>

                <ProjectIdentityPanel projectId={id} />
                <ProjectPlacementPanel projectId={id} />
            </section>

            <section className="flex flex-col gap-4">
                <header>
                    <h2 className="h-section">Issues</h2>
                    <p className="mt-1 text-[13px] text-[color:var(--c-text-muted)]">
                        How this project handles incoming issues.
                    </p>
                </header>

                <DuplicateSensitivityPanel projectId={id} />
            </section>

            <section className="flex flex-col gap-4">
                <header>
                    <h2 className="h-section text-rose-700">Danger zone</h2>
                    <p className="mt-1 text-[13px] text-[color:var(--c-text-muted)]">
                        Irreversible actions. Double-check before you proceed.
                    </p>
                </header>

                <DangerZonePanel projectId={id} />
            </section>
        </div>
    )
}
