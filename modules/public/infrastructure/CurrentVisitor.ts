// Reads the current request's authenticated visitor (cookie-bound). A distinct
// boundary from the injected repository — it reads the request, not the DB — used
// by the PublicSessionService gate and the public routes/pages at submission time
// (attribution) and read time ('own'-visibility).

import { Supabase } from "@/lib/server/supabase"

export interface PublicVisitor {
    id: string
    email: string | null
}

export class CurrentVisitor {
    /** The signed-in visitor, or null for anonymous. Never throws. */
    async current(): Promise<PublicVisitor | null> {
        const user = await Supabase.currentUser()
        if (!user) return null
        return { id: user.id, email: (user.email ?? "").trim().toLowerCase() || null }
    }
}
