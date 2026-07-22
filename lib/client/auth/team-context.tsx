"use client"

import { createContext, useCallback, useContext, useMemo } from "react"
import { useAuth } from "@/lib/client/auth/auth-context"
import { useApi } from "@/lib/client/hooks/use-api"
import type { TeamWithRole } from "@/lib/shared/types"

// Client-side "active team" context. The active team is persisted in the
// `team_id` cookie, which rides along on every same-origin fetch so the server's
// requireTeam() resolves the same team — no per-request header plumbing needed.
// Switching teams writes the cookie and reloads into /projects so every client
// data hook refetches under the new team.
//
// Mounted inside the authed (app) shell, below AuthProvider.

const COOKIE = "team_id"

function readCookie(name: string): string | null {
    if (typeof document === "undefined") return null
    const m = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`))
    return m ? decodeURIComponent(m[1]) : null
}
function writeCookie(name: string, value: string): void {
    document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=31536000; samesite=lax`
}

interface TeamState {
    teams: TeamWithRole[]
    activeTeam: TeamWithRole | null
    loading: boolean
    /** Switch teams: persist + reload so all data refetches under it. */
    setActiveTeam: (id: string) => void
    /** Re-fetch the team list (after create/rename/delete). */
    refetch: () => void
}

const TeamContext = createContext<TeamState | undefined>(undefined)

export function TeamProvider({ children }: { children: React.ReactNode }) {
    const { user } = useAuth()
    const { data, loading, refetch } = useApi<{ teams: TeamWithRole[] }>("/api/teams", { enabled: !!user })
    const teams = useMemo(() => data?.teams ?? [], [data])

    const activeTeam = useMemo(() => {
        if (teams.length === 0) return null
        const wanted = readCookie(COOKIE)
        return teams.find((t) => t.id === wanted) ?? teams.find((t) => t.is_personal) ?? teams[0]
    }, [teams])

    const setActiveTeam = useCallback((id: string) => {
        writeCookie(COOKIE, id)
        // Hard navigation guarantees the sidebar list, current page, and every
        // client useApi() call refetch under the new team's cookie.
        window.location.assign("/projects")
    }, [])

    const value = useMemo<TeamState>(
        () => ({ teams, activeTeam, loading, setActiveTeam, refetch }),
        [teams, activeTeam, loading, setActiveTeam, refetch],
    )

    return <TeamContext.Provider value={value}>{children}</TeamContext.Provider>
}

export function useTeam(): TeamState {
    const ctx = useContext(TeamContext)
    if (!ctx) throw new Error("useTeam must be used within <TeamProvider>")
    return ctx
}
