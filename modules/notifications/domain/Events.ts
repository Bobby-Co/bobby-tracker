// Notifications domain — the typed event catalogue + per-kind rendering. This is
// the SINGLE SOURCE OF TRUTH for "a notification kind". Before the refactor,
// adding one meant editing FIVE places (a SQL CHECK constraint, a trigger
// function, a TS union, the popover style map, and the email switch); here it is
// one case the compiler forces you to handle (OCP, exhaustiveness-checked).
//
// Pure domain: no I/O, no framework, no SDK.

export type NotificationKind = "kb_ready" | "kb_updated" | "pr_opened" | "pr_analysis_ready"

/** Push channels. Extend the union to add one (e.g. "web_push" | "slack") — the
 *  dispatcher and existing channels don't change (OCP). */
export type ChannelId = "in_app" | "email"

interface BaseEvent {
    readonly kind: NotificationKind
    readonly projectId: string
    /** ISO-8601, stamped by the emitter via the Clock port. */
    readonly occurredAt: string
}
export interface KbReadyEvent extends BaseEvent { readonly kind: "kb_ready"; readonly projectName: string }
export interface KbUpdatedEvent extends BaseEvent { readonly kind: "kb_updated"; readonly projectName: string }
export interface PrOpenedEvent extends BaseEvent {
    readonly kind: "pr_opened"
    readonly projectName: string
    readonly prNumber: number
    readonly authorLogin: string | null
}
export interface PrAnalysisReadyEvent extends BaseEvent {
    readonly kind: "pr_analysis_ready"
    readonly projectName: string
    readonly prNumber: number
    readonly score: number | null
    readonly scoreMax: number | null
}

/** Discriminated union — payloads carry the FACTS; presentation is derived below,
 *  so copy for a kind lives in exactly one place. */
export type NotificationEvent = KbReadyEvent | KbUpdatedEvent | PrOpenedEvent | PrAnalysisReadyEvent

/** The feed row is a point-in-time snapshot (matching migration 0049's model). */
export interface RenderedNotification {
    readonly title: string
    readonly meta: string | null
    readonly href: string
}

/** Render a kind's feed presentation. Exhaustive switch with no default: add a
 *  new event kind and the compiler forces a case here. Copy mirrors migration
 *  0049's trigger bodies — now owned by the app, in one place. */
export function renderNotification(event: NotificationEvent): RenderedNotification {
    switch (event.kind) {
        case "kb_ready":
            return { title: "Knowledge base is ready!", meta: event.projectName, href: `/projects/${event.projectId}` }
        case "kb_updated":
            return { title: "Knowledge base update finished", meta: event.projectName, href: `/projects/${event.projectId}` }
        case "pr_opened":
            return {
                title: `${event.authorLogin ?? "Someone"} opened a pull request`,
                meta: `${event.projectName} · PR #${event.prNumber}`,
                href: `/projects/${event.projectId}/pulls/${event.prNumber}`,
            }
        case "pr_analysis_ready": {
            const scored = event.score != null && event.scoreMax != null
            return {
                title: scored ? `PR review ready — ${event.score}/${event.scoreMax}` : "PR review ready",
                meta: `${event.projectName} · PR #${event.prNumber}`,
                href: `/projects/${event.projectId}/pulls/${event.prNumber}`,
            }
        }
    }
}

/** Channels a kind targets by default (before per-user preferences narrow it). */
export function defaultChannelsFor(kind: NotificationKind): readonly ChannelId[] {
    switch (kind) {
        case "kb_ready":
        case "kb_updated":
        case "pr_opened":
        case "pr_analysis_ready":
            return ["in_app", "email"]
    }
}
