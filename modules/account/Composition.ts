// Account module — composition root. The identity store needs the SERVICE-ROLE
// key (auth.admin.*), so it binds to Supabase.service() rather than to a
// request-scoped client.

import { Supabase } from "@/lib/server/supabase"
import { createSupabaseAuthIdentityStore } from "./infrastructure/SupabaseAuthIdentityStore"
import type { AccountIdentityStore } from "./ports/AccountIdentityStore"

export function getAccountIdentityStore(): AccountIdentityStore {
    return createSupabaseAuthIdentityStore(Supabase.service())
}
