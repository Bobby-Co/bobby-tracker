// Shared helpers for tracker API route handlers.

import type { User } from "@supabase/supabase-js"
import { createClient } from "@/lib/supabase/server"

type SupabaseServer = Awaited<ReturnType<typeof createClient>>

export function jsonError(code: string, message: string, status: number) {
    return Response.json({ error: { code, message } }, { status })
}

type AuthOK   = { supabase: SupabaseServer; user: User;  error: null }
type AuthFail = { supabase: SupabaseServer; user: null;  error: Response }

export async function requireUser(): Promise<AuthOK | AuthFail> {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
        return { supabase, user: null, error: jsonError("unauthorized", "sign in required", 401) }
    }
    return { supabase, user, error: null }
}
