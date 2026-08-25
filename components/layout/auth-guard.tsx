"use client"

import { useEffect, type ReactNode } from "react"
import { usePathname, useRouter } from "next/navigation"
import { useAuth } from "@/lib/client/auth/auth-context"
import { BetaAccess } from "@/lib/shared/BetaAccess"

// Who is allowed past, and where they go if they are not.
//
// Extracted from the app layout when the purchase flow moved out of it. Two
// layouts now need the same answer while rendering completely different chrome,
// and the one thing that must NOT be copied between them is this: a divergence
// here is an unauthenticated visitor reaching a page that assumes a session.
//
// The guard is UX only. RLS at the database is the real boundary, and every route
// handler re-checks the user through requireUser() — this just avoids flashing
// protected content at someone on their way to /login.
export function AuthGuard({ children, fallback }: { children: ReactNode; fallback: ReactNode }) {
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
        if (!new BetaAccess().isAllowed(user)) router.replace("/waitlist")
    }, [loading, user, pathname, router])

    // Still resolving the session, or mid-redirect. The caller supplies the
    // placeholder because what "loading" should look like depends entirely on the
    // chrome around it.
    if (loading || !user || !user.user_metadata?.onboarded || !new BetaAccess().isAllowed(user)) {
        return <>{fallback}</>
    }
    return <>{children}</>
}
