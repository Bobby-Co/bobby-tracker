import type { User } from "@supabase/supabase-js"

// Beta access gate ("the whitelist"). A user is let into the app when EITHER:
//   • their auth metadata carries `whitelisted: true` (set by an admin once
//     their beta spot opens), OR
//   • their email is in NEXT_PUBLIC_BETA_ALLOWED_EMAILS (comma-separated) — a
//     convenience allowlist for the team/admins so they always get in without
//     a metadata write.
// Everyone else is redirected to /waitlist.
//
// This is deliberately a single helper so the source of truth is easy to swap
// later (e.g. a `tracker.allowlist` table behind an API route) without touching
// the call sites in the callback, the app guard, onboarding, or the page.
//
// NOTE: it reads NEXT_PUBLIC_* so the SAME check runs on both the server
// (OAuth callback) and the client (route guards). Keep the allowlist short —
// public env vars ship in the client bundle.
export function isAllowed(user: User | null | undefined): boolean {
    if (!user) return false
    if (user.user_metadata?.whitelisted === true) return true

    const raw = process.env.NEXT_PUBLIC_BETA_ALLOWED_EMAILS ?? ""
    const allow = raw
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean)
    const email = (user.email ?? "").toLowerCase()
    return email.length > 0 && allow.includes(email)
}
