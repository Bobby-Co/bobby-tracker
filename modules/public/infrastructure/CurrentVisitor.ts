// Public infrastructure — the current-visitor read. A cookie-bound auth lookup
// that is a DISTINCT boundary from the injected repository: it reads the request
// (not the service-role DB), so it stays a small named boundary function rather
// than a repository method (the vcs resolveCommentContext precedent). Used by the
// PublicSessionService gate and directly by the public routes/pages at submission
// time (attribution) and read time ('own'-visibility).

import { getCurrentUser } from "@/lib/supabase/server"

export interface PublicVisitor {
    id: string
    email: string | null
}

/** Read the current request's authenticated visitor (cookie-bound). Returns null
 *  for anonymous visitors — never throws. */
export async function getCurrentPublicUser(): Promise<PublicVisitor | null> {
    const user = await getCurrentUser()
    if (!user) return null
    return { id: user.id, email: (user.email ?? "").trim().toLowerCase() || null }
}
