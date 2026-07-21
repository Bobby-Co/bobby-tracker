// Teams domain — invite value helpers (migration 0052 `team_invites`). Pure
// derivations owned by the invite concept: token minting, email normalisation
// and validation, and the app base URL an accept-link is built on. No IO — the
// email send lives behind the InviteNotifier port (the vcs precedent: pure value
// helpers stay functions in a well-named concept file).

/** A 64-hex, URL-safe invite token (satisfies the length>=16 DB check). */
export function newInviteToken(): string {
    return (crypto.randomUUID() + crypto.randomUUID()).replace(/-/g, "")
}

/** The app's public base URL — operator-configured NEXT_PUBLIC_APP_URL, else the
 *  request origin. Mirrors the notification-email / relay convention. */
export function baseUrl(request: Request): string {
    return (process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/+$/, "")) || new URL(request.url).origin
}

/** Normalise an email for storage/compare (matches the DB's lower(email) index). */
export function normalizeEmail(email: string): string {
    return email.trim().toLowerCase()
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
export function isValidEmail(email: string): boolean {
    return EMAIL_RE.test(email)
}
