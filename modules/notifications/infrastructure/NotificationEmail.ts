// The email side of notifications: the parallel channel that reaches a user when
// they're not looking at the app. ONE entry point — send(id) — invoked by the
// DB→app callback (/api/internal/notification-email, migration 0051's pg_net
// trigger). Best-effort + self-gating: an unconfigured transport short-circuits
// before any work.
//
// This adapter does I/O only: load the row, resolve the recipient, gather the
// enrichment through the shared EnrichmentSource. The copy and the markup are
// EmailTemplates'.
//
// (Legacy trigger-path renderer; retires when the outbox cutover takes over.
// Until then it renders through the same templates and loads the same
// enrichment as EmailChannel, so which path delivered a mail is invisible to
// the person reading it.)

import { EmailTransport } from "@/lib/server/email/EmailTransport"
import { Supabase } from "@/lib/server/supabase"
import type { NotificationKind } from "@/lib/shared/types"

import type { EnrichmentSource } from "../ports/EnrichmentSource"
import { renderNotificationEmail, type NotificationEmailContext } from "./EmailTemplates"
import { createSupabaseEnrichmentSource } from "./SupabaseEnrichmentSource"

type Svc = ReturnType<typeof Supabase.service>

interface NotificationRow {
    id: string
    user_id: string
    project_id: string | null
    kind: NotificationKind
    title: string
    meta: string | null
    href: string | null
}

export class NotificationEmail {
    private readonly mail = new EmailTransport()
    private readonly enrichment: EnrichmentSource

    constructor(enrichment?: EnrichmentSource) {
        this.enrichment = enrichment ?? createSupabaseEnrichmentSource()
    }

    /** Load the notification, resolve the recipient, send a per-kind email. No-op
     *  (never throws for config/lookup reasons) when email is unconfigured or the
     *  owner has no resolvable address. */
    async send(notificationId: string): Promise<void> {
        if (!this.mail.isConfigured()) return

        const svc = Supabase.service()
        const { data: n } = await svc
            .from("notifications")
            .select("id,user_id,project_id,kind,title,meta,href")
            .eq("id", notificationId)
            .maybeSingle<NotificationRow>()
        if (!n?.user_id) return

        const email = await this.resolveUserEmail(svc, n.user_id)
        if (!email) return

        const built = renderNotificationEmail(await this.buildContext(n))
        await this.mail.send({ to: email, subject: built.subject, html: built.html, text: built.text })
    }

    private async buildContext(n: NotificationRow): Promise<NotificationEmailContext> {
        const prNumber = this.prNumberFrom(n.href)
        const extra = await this.enrichment.load({ kind: n.kind, projectId: n.project_id, prNumber })
        return {
            kind: n.kind,
            projectName: extra.projectName || "your project",
            url: this.absoluteUrl(n.href),
            repoFullName: extra.repoFullName,
            prNumber,
            pull: extra.pull,
            analysis: extra.analysis,
            fallbackTitle: n.title,
            fallbackMeta: n.meta,
        }
    }

    // auth.users email via the service-role admin API — identity lives only in
    // Supabase auth (no profiles mirror), and this is a server-to-server context.
    private async resolveUserEmail(svc: Svc, userId: string): Promise<string | null> {
        try {
            const { data, error } = await svc.auth.admin.getUserById(userId)
            if (error) return null
            return data.user?.email ?? null
        } catch {
            return null
        }
    }

    /** The PR number comes from the notification href (/projects/<id>/pulls/<n>). */
    private prNumberFrom(href: string | null): number | null {
        const m = href?.match(/\/pulls\/(\d+)/)
        return m ? Number(m[1]) : null
    }

    // NEXT_PUBLIC_APP_URL is required here (a DB-driven callback has no request
    // origin) — without it the button won't resolve in a mail client.
    private absoluteUrl(href: string | null): string {
        const base = (process.env.NEXT_PUBLIC_APP_URL?.trim() || "").replace(/\/+$/, "")
        if (!href) return base
        if (/^https?:\/\//.test(href)) return href
        return base ? `${base}${href.startsWith("/") ? "" : "/"}${href}` : href
    }
}
