"use client"

import { useEffect, useState } from "react"
import { AuthProvider } from "@/lib/client/auth/auth-context"
import { TeamProvider } from "@/lib/client/auth/team-context"
import { Sidebar, SidebarToggleProvider, type SidebarMode } from "@/components/layout/sidebar"
import type { Project } from "@/lib/shared/types"

// The real Sidebar morphing full ↔ rail, driven by a toggle.
//
// It mounts the actual Auth/Team providers so SidebarContent renders unchanged.
// Without a session the auth context resolves to no user, so the team switcher
// and balance pill show their skeletons — but those skeletons morph their own
// containers too, and the brand, nav, featured projects (passed in) and account
// card exercise the full label-fold. What this proves is the mechanic the swap
// version couldn't: the SAME elements shortening to icons, no popping.

const PROJECTS: Project[] = [
    { id: "p1", name: "Checkout", team_id: "t", created_at: "", updated_at: "" },
    { id: "p2", name: "Analyser", team_id: "t", created_at: "", updated_at: "" },
    { id: "p3", name: "Web app", team_id: "t", created_at: "", updated_at: "" },
] as unknown as Project[]

function useStubbedApi() {
    useEffect(() => {
        const real = window.fetch
        window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
            const url = typeof input === "string" ? input : input.toString()
            if (url.includes("/api/projects")) return json({ projects: PROJECTS })
            if (url.includes("/api/teams") && url.includes("/groups")) return json({ groups: [] })
            if (url.includes("/api/teams")) return json({ teams: [] })
            if (url.includes("/api/billing/balance"))
                return json({
                    balance: {
                        tierName: "Prowl",
                        allowance: 10_000,
                        used: 1_940,
                        remaining: 8_060,
                        fraction: 0.194,
                        isExhausted: false,
                        uncapped: false,
                    },
                })
            return real(input, init)
        }
        return () => {
            window.fetch = real
        }
    }, [])
}

function json(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })
}

export default function SidebarMorphPreview() {
    return (
        <AuthProvider>
            <TeamProvider>
                <Harness />
            </TeamProvider>
        </AuthProvider>
    )
}

function Harness() {
    useStubbedApi()
    const [mode, setMode] = useState<SidebarMode>("full")

    const toggle = () => setMode((m) => (m === "full" ? "rail" : "full"))

    return (
        <div className="flex h-screen w-full bg-[color:var(--c-shell)] text-[color:var(--c-text)]">
            <SidebarToggleProvider toggle={mode === "hidden" ? null : toggle}>
                <Sidebar projects={PROJECTS} mode={mode} />
            </SidebarToggleProvider>
            <div className="flex flex-1 flex-col items-start gap-3 p-8">
                <h1 className="text-[20px] font-extrabold tracking-[-0.012em]">Sidebar morph</h1>
                <div className="flex gap-2">
                    <button onClick={() => setMode("full")} className={mode === "full" ? "btn-primary" : "btn-ghost"}>Full</button>
                    <button onClick={() => setMode("rail")} className={mode === "rail" ? "btn-primary" : "btn-ghost"}>Rail</button>
                    <button onClick={() => setMode("hidden")} className={mode === "hidden" ? "btn-primary" : "btn-ghost"}>Hidden</button>
                </div>
                <p className="text-[12.5px] text-[color:var(--c-text-muted)]">
                    Click the logo (or the header toggle) to collapse/expand. No session here, so the
                    team switch + balance show skeletons; everything else morphs.
                </p>
            </div>
        </div>
    )
}
