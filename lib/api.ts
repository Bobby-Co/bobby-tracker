// Shared helpers for tracker API route handlers.

import type { User } from "@supabase/supabase-js"
import { createClient, getCurrentUser } from "@/lib/supabase/server"

type SupabaseServer = Awaited<ReturnType<typeof createClient>>

export function jsonError(code: string, message: string, status: number) {
    return Response.json({ error: { code, message } }, { status })
}

type AuthOK   = { supabase: SupabaseServer; user: User;  error: null }
type AuthFail = { supabase: SupabaseServer; user: null;  error: Response }

export async function requireUser(): Promise<AuthOK | AuthFail> {
    // Run the (cached) auth check and the cookie-bound client setup
    // in parallel — they don't depend on each other.
    const [user, supabase] = await Promise.all([getCurrentUser(), createClient()])
    if (!user) {
        return { supabase, user: null, error: jsonError("unauthorized", "sign in required", 401) }
    }
    return { supabase, user, error: null }
}
