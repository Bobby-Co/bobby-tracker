// Notifications infrastructure — the email NotificationChannel adapter. Renders
// the event via the domain and sends a minimal transactional email through the
// existing JMAP transport (lib/platform/email/jmap.ts).
//
// DORMANT reference code: it typechecks but isn't wired to producers yet.
//
// This is a MINIMAL template; migrating to the rich per-kind templates in
// lib/email/notifications.ts is a cutover follow-up.

import { isEmailConfigured, sendMail } from "@/lib/platform/email/jmap"

import type { NotificationEvent } from "../domain/events"
import { renderNotification } from "../domain/events"
import type { NotificationChannel } from "../ports/notification-channel"
import type { Recipient } from "../ports/recipient-resolver"

export function createEmailChannel(): NotificationChannel {
    return {
        id: "email",
        supports(): boolean {
            return true
        },
        async deliver(event: NotificationEvent, recipient: Recipient) {
            // Never-throw contract: opt-out / no-address / unconfigured all
            // RESOLVE with { delivered:false, reason }.
            if (!isEmailConfigured()) return { delivered: false, reason: "email not configured" }
            if (!recipient.email) return { delivered: false, reason: "no address" }

            const { title, meta, href } = renderNotification(event)

            const subject = meta && !title.includes(meta) ? `${title} · ${meta}` : title

            const base = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/+$/, "")
            const url = href.startsWith("/") ? `${base}${href}` : href

            const html =
                `<div style="font-family:system-ui,-apple-system,sans-serif;font-size:14px;line-height:1.5;color:#111">` +
                `<h1 style="font-size:18px;margin:0 0 8px">${title}</h1>` +
                (meta ? `<p style="margin:0 0 12px;color:#555">${meta}</p>` : "") +
                `<p style="margin:0"><a href="${url}" style="color:#2563eb">Open in the app</a></p>` +
                `</div>`

            const text = [title, meta, url].filter(Boolean).join("\n")

            try {
                await sendMail({ to: recipient.email, subject, html, text })
                return { delivered: true }
            } catch (e) {
                const reason = e instanceof Error ? e.message : String(e)
                return { delivered: false, reason }
            }
        },
    }
}
