"use client"
// TEMPORARY harness — same purpose as preview/dashboard. The region map's
// geometry and the delete-confirmation flow can only be checked by looking, and
// both live behind auth in the real app.

import { useState } from "react"
import { TeamProvider } from "@/lib/client/auth/team-context"
import { RegionMap } from "@/components/teams/region-map"
import { SettingsTab } from "@/components/teams/settings-tab"
import type { TeamWithRole } from "@/lib/shared/types"

const REGIONS = [
    { id: "north-america", label: "North America" },
    { id: "south-east-asia", label: "South East Asia" },
    { id: "europe", label: "Europe" },
    { id: "oceania", label: "Oceania" },
    { id: "mars-1", label: "Mars" }, // unmapped id → falls through to the chip list
]

const TEAM: TeamWithRole = {
    id: "t1", name: "Acme Engineering", is_personal: false, created_by: "u1",
    region: "south-east-asia", cell: "bangkok-0",
    created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z",
    role: "owner",
}

export default function PreviewRegionMap() {
    const [region, setRegion] = useState("north-america")
    return (
        <TeamProvider>
            <div className="mx-auto flex max-w-2xl flex-col gap-6 p-8">
                <div className="flex flex-col gap-3">
                    <h1 className="text-[18px] font-bold">Region map</h1>
                    <RegionMap regions={REGIONS} value={region} onChange={setRegion} />
                    <p className="text-[12px] text-[color:var(--c-text-muted)]">selected: {region}</p>
                </div>
                <div className="flex flex-col gap-3">
                    <h1 className="text-[18px] font-bold">Team settings</h1>
                    <SettingsTab team={TEAM} />
                </div>
            </div>
        </TeamProvider>
    )
}
