// Helpers for team email invitations (migration 0052 `team_invites`).

import { isEmailConfigured, sendMail } from "@/lib/email/jmap"
import type { TeamRole } from "@/lib/supabase/types"

/** A 64-hex, URL-safe invite token (satisfies the length>=16 DB check). */
export function newInviteToken(): string {
    return (crypto.randomUUID() + crypto.randomUUID()).replace(/-/g, "")
}

/** The app's public base URL — operator-configured NEXT_PUBLIC_APP_URL, else the
 *  request origin. Mirrors lib/email/notifications.ts / relay's convention. */
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

/** Send the invitation email. No-ops when SMTP is unconfigured (same posture as
 *  the notification emails) so the invite is still created and can be resent. */
export async function sendInviteEmail(opts: {
    to: string
    teamName: string
    inviterName: string | null
    acceptUrl: string
    role: TeamRole
}): Promise<void> {
    if (!isEmailConfigured()) return
    const who = opts.inviterName ? `${opts.inviterName} invited you` : "You've been invited"
    const subject = `${who} to join ${opts.teamName} on Ucelot`
    const text = [
        `${who} to join the team "${opts.teamName}" on Ucelot as ${opts.role}.`,
        "",
        "Accept the invitation:",
        opts.acceptUrl,
        "",
        "— Ucelot",
    ].join("\n")
    const html = [
        `<div style="font:14px/1.6 -apple-system,Segoe UI,Roboto,sans-serif;color:#18181b">`,
        `<p>${escapeHtml(who)} to join the team <strong>${escapeHtml(opts.teamName)}</strong> on Ucelot as <strong>${opts.role}</strong>.</p>`,
        `<p><a href="${escapeHtml(opts.acceptUrl)}" style="display:inline-block;background:#ea580c;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600">Accept invitation</a></p>`,
        `<p style="color:#71717a;font-size:12px">Or paste this link into your browser:<br>${escapeHtml(opts.acceptUrl)}</p>`,
        `<p style="color:#a1a1aa;font-size:12px">— Ucelot</p>`,
        `</div>`,
    ].join("")
    await sendMail({ to: opts.to, subject, html, text })
}

function escapeHtml(s: string): string {
    return s.replace(/[&<>"']/g, (c) => (
        { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string
    ))
}
