"use client"

import { useEffect } from "react"
import { usePathname, useRouter } from "next/navigation"
import { useAuth } from "@/lib/auth/auth-context"
import { isAllowed } from "@/lib/auth/access"
import { useApi } from "@/lib/hooks/use-api"
import { AppShell, ShellSkeleton } from "@/components/app-shell"
import type { Project } from "@/lib/supabase/types"

// Auth-gated app shell — now a client guard instead of a server
// component. useAuth() owns the session; an unauthenticated visitor is
// redirected to /login. The sidebar's project list comes from
// /api/projects (cookie-authed) rather than a direct server query.
//
// The guard is UX only: RLS at the database is the real boundary, and
// every route handler re-checks the user via requireUser().
export default function AppLayout({ children }: { children: React.ReactNode }) {
    const { user, loading } = useAuth()
    const router = useRouter()
    const pathname = usePathname()

    useEffect(() => {
        if (loading) return
        if (!user) {
            const next = encodeURIComponent(pathname || "/projects")
            router.replace(`/login?next=${next}`)
            return
        }
        // Onboard before the beta gate, so the waitlist is only ever reached
        // after onboarding is complete.
        if (!user.user_metadata?.onboarded) {
            router.replace(`/onboarding?next=${encodeURIComponent(pathname || "/projects")}`)
            return
        }
        // Onboarded but not on the beta whitelist → coming-soon page.
        if (!isAllowed(user)) router.replace("/waitlist")
    }, [loading, user, pathname, router])

    // Only fetch the sidebar list once we know there's a user — avoids a
    // throwaway 401 during the initial session read / redirect.
    const { data } = useApi<{ projects: Project[] }>("/api/projects", {
        enabled: !!user,
    })
    const projects = data?.projects ?? []

    // Still resolving the session, or mid-redirect to /login, /onboarding or
    // /waitlist. Show the shell skeleton rather than flashing protected content.
    if (loading || !user || !user.user_metadata?.onboarded || !isAllowed(user)) {
        return <ShellSkeleton />
    }

    return <AppShell projects={projects}>{children}</AppShell>
}
