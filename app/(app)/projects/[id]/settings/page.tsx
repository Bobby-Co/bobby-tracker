"use client"

import { useParams } from "next/navigation"
import { DangerZonePanel } from "@/components/projects/danger-zone-panel"

// Project settings. Most per-project configuration lives with the thing it
// controls — GitHub sync on Integrations, indexing + auto-update + effort on
// Knowledge. What's left here is the destructive stuff: deleting the project.
// Kept as its own tab so a future account/danger setting has a home.
export default function SettingsPage() {
    const { id } = useParams<{ id: string }>()

    return (
        <div className="flex flex-col gap-4">
            <header>
                <h2 className="h-section text-rose-700">Danger zone</h2>
                <p className="mt-1 text-[13px] text-[color:var(--c-text-muted)]">
                    Irreversible actions. Double-check before you proceed.
                </p>
            </header>

            <DangerZonePanel projectId={id} />
        </div>
    )
}
