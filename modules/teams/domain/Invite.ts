// Team invite value helpers (migration 0052 `team_invites`): mint the token and
// build the public accept-link it's delivered on.

export class Invite {
    /** A 64-hex, URL-safe token (satisfies the length>=16 DB check). */
    newToken(): string {
        return (crypto.randomUUID() + crypto.randomUUID()).replace(/-/g, "")
    }

    /** The public accept-link for a token — operator-configured NEXT_PUBLIC_APP_URL,
     *  else the request origin. */
    acceptUrl(request: Request, token: string): string {
        const base = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/+$/, "") || new URL(request.url).origin
        return `${base}/invite/${token}`
    }
}
