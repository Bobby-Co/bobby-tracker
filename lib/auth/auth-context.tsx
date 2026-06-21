"use client"

import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useState,
} from "react"
import type { Session, User } from "@supabase/supabase-js"
import { createClient } from "@/lib/supabase/client"

// Client-side auth context. This replaces the old server/middleware
// scheme: the browser Supabase client owns the session (stored in the
// shared-domain cookie, so cross-app SSO with Bobby CI still works) and
// auto-refreshes the access token in the background. There is no
// per-request server auth round-trip and no proxy/middleware.
//
// Data still flows `client + cookie → route handler → db`. This context
// is *only* the auth lifecycle (who's signed in, refresh, sign out);
// the browser client never queries the database directly. RLS at the
// database remains the real security boundary — the route guards built
// on top of this context are UX, not enforcement.

interface AuthState {
    user: User | null
    session: Session | null
    /** True until the initial session read resolves. */
    loading: boolean
    signOut: () => Promise<void>
}

const AuthContext = createContext<AuthState | undefined>(undefined)

export function AuthProvider({ children }: { children: React.ReactNode }) {
    // One browser client per provider instance. createBrowserClient
    // reads/writes the auth cookie and runs the refresh timer.
    const [supabase] = useState(() => createClient())
    const [session, setSession] = useState<Session | null>(null)
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        let active = true

        // Initial read from the cookie. onAuthStateChange below also
        // fires an INITIAL_SESSION event, but we resolve `loading`
        // here too so a provider that never gets an event (e.g. signed
        // out) still settles.
        supabase.auth.getSession().then(({ data }) => {
            if (!active) return
            setSession(data.session)
            setLoading(false)
        })

        // Keeps the context live across sign-in, sign-out, token
        // refresh, and cross-tab changes.
        const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
            setSession(next)
            setLoading(false)
        })

        return () => {
            active = false
            sub.subscription.unsubscribe()
        }
    }, [supabase])

    const signOut = useCallback(async () => {
        await supabase.auth.signOut()
        // onAuthStateChange fires SIGNED_OUT → session clears.
    }, [supabase])

    const value = useMemo<AuthState>(
        () => ({ user: session?.user ?? null, session, loading, signOut }),
        [session, loading, signOut],
    )

    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthState {
    const ctx = useContext(AuthContext)
    if (!ctx) throw new Error("useAuth must be used within <AuthProvider>")
    return ctx
}
