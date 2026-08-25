// Notifications infrastructure — the email NotificationChannel adapter. Renders
// the event through the shared templates and sends it over the app's
// EmailTransport (JMAP).
//
// DORMANT reference code: it typechecks but isn't wired to producers yet.
//
// It renders through the SAME EmailTemplates as the legacy trigger path
// (NotificationEmail) and loads the same EnrichmentSource, so the cutover
// changes how a mail is dispatched without changing what arrives. Constructed
// without a source it still delivers — the mail is just the event's own facts.

import { EmailTransport } from "@/lib/server/email/EmailTransport"

import type { NotificationEvent } from "../domain/Events"
import { NotificationPresenter } from "../domain/Events"
import type { NotificationChannel } from "../ports/NotificationChannel"
import type { EnrichmentSource } from "../ports/EnrichmentSource"
import { NO_ENRICHMENT } from "../ports/EnrichmentSource"
import type { Recipient } from "../ports/RecipientResolver"
import { renderNotificationEmail, type NotificationEmailContext } from "./EmailTemplates"

/** The email NotificationChannel. Stateless; construct via the factory below. */
export class EmailChannel implements NotificationChannel {
    readonly id = "email" as const
    private readonly presenter = new NotificationPresenter()
    private readonly mail = new EmailTransport()

    constructor(private readonly enrichment?: EnrichmentSource) {}

    supports(): boolean {
        return true
    }

    async deliver(event: NotificationEvent, recipient: Recipient) {
        // Never-throw contract: opt-out / no-address / unconfigured all RESOLVE
        // with { delivered:false, reason }.
        if (!this.mail.isConfigured()) return { delivered: false, reason: "email not configured" }
        if (!recipient.email) return { delivered: false, reason: "no address" }

        const built = renderNotificationEmail(await this.contextFor(event))
        try {
            await this.mail.send({ to: recipient.email, subject: built.subject, html: built.html, text: built.text })
            return { delivered: true }
        } catch (e) {
            const reason = e instanceof Error ? e.message : String(e)
            return { delivered: false, reason }
        }
    }

    // The event carries the facts, the presenter the feed copy the fallback
    // template needs, and the enrichment everything the event was too thin to.
    private async contextFor(event: NotificationEvent): Promise<NotificationEmailContext> {
        const { title, meta, href } = this.presenter.render(event)
        const prNumber = "prNumber" in event ? event.prNumber : null
        const extra = this.enrichment
            ? await this.enrichment.load({ kind: event.kind, projectId: event.projectId, prNumber })
            : NO_ENRICHMENT
        const base = (process.env.NEXT_PUBLIC_APP_URL?.trim() || "").replace(/\/+$/, "")

        return {
            kind: event.kind,
            // The event's name is a point-in-time snapshot; prefer it over the
            // current row so a rename can't contradict the feed entry beside it.
            projectName: event.projectName || extra.projectName || "your project",
            url: href.startsWith("/") ? `${base}${href}` : href,
            repoFullName: extra.repoFullName,
            prNumber,
            pull: extra.pull,
            analysis: extra.analysis,
            reason: event.kind === "kb_failed" ? event.reason : null,
            score: event.kind === "pr_analysis_ready" ? event.score : null,
            scoreMax: event.kind === "pr_analysis_ready" ? event.scoreMax : null,
            fallbackTitle: title,
            fallbackMeta: meta,
        }
    }
}

/** Composition seam: hands back the NotificationChannel. Pass an EnrichmentSource
 *  to get the full-bodied mails; omit it for the event's facts alone. */
export function createEmailChannel(enrichment?: EnrichmentSource): NotificationChannel {
    return new EmailChannel(enrichment)
}
