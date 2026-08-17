// Teams infrastructure — the JMAP InviteNotifier adapter. Owns all the email
// vendor detail: the configured-check, the subject/text/html templating, HTML
// escaping, and the transport call. Swapping the channel = swapping this file;
// nothing that depends on the InviteNotifier port changes.

import { EmailTransport } from "@/lib/server/email/EmailTransport"
import type { InviteMessage, InviteNotifier } from "../ports/InviteNotifier"

/** Delivers invites over the app's JMAP transport. No-ops when email is
 *  unconfigured (same posture as the notification emails). Construct via the
 *  composition root. */
export class JmapInviteNotifier implements InviteNotifier {
    private readonly mail = new EmailTransport()

    async sendInvite(message: InviteMessage): Promise<void> {
        if (!this.mail.isConfigured()) return
        const who = message.inviterName ? `${message.inviterName} invited you` : "You've been invited"
        const subject = `${who} to join ${message.teamName} on Ucelot`
        const text = [
            `${who} to join the team "${message.teamName}" on Ucelot as ${message.role}.`,
            "",
            "Accept the invitation:",
            message.acceptUrl,
            "",
            "— Ucelot",
        ].join("\n")
        const html = [
            `<div style="font:14px/1.6 -apple-system,Segoe UI,Roboto,sans-serif;color:#18181b">`,
            `<p>${escapeHtml(who)} to join the team <strong>${escapeHtml(message.teamName)}</strong> on Ucelot as <strong>${message.role}</strong>.</p>`,
            `<p><a href="${escapeHtml(message.acceptUrl)}" style="display:inline-block;background:#ea580c;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600">Accept invitation</a></p>`,
            `<p style="color:#71717a;font-size:12px">Or paste this link into your browser:<br>${escapeHtml(message.acceptUrl)}</p>`,
            `<p style="color:#a1a1aa;font-size:12px">— Ucelot</p>`,
            `</div>`,
        ].join("")
        await this.mail.send({ to: message.to, subject, html, text })
    }
}

function escapeHtml(s: string): string {
    return s.replace(/[&<>"']/g, (c) => (
        { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string
    ))
}
