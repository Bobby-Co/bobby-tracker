"use client"

import { TeamProvider } from "@/lib/client/auth/team-context"
import { useAuth } from "@/lib/client/auth/auth-context"
import { useApi } from "@/lib/client/hooks/use-api"
import { AuthGuard } from "@/components/layout/auth-guard"
import { AppShell, ShellSkeleton } from "@/components/layout/app-shell"
import type { Project } from "@/lib/shared/types"

// The signed-in app: sidebar, team switcher, everything with navigation in it.
//
// The admission rules live in AuthGuard, shared with the purchase flow — which
// needs the same session but none of this chrome. See app/(purchase)/layout.tsx.
export default function AppLayout({ children }: { children: React.ReactNode }) {
    const { user } = useAuth()

    // Only fetch the sidebar list once we know there's a user — avoids a
    // throwaway 401 during the initial session read / redirect.
    const { data } = useApi<{ projects: Project[] }>("/api/projects", { enabled: !!user })
    const projects = data?.projects ?? []

    return (
        <AuthGuard fallback={<ShellSkeleton />}>
            <TeamProvider>
                <AppShell projects={projects}>{children}</AppShell>
            </TeamProvider>
        </AuthGuard>
    )
}
