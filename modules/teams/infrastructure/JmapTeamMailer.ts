// Teams infrastructure — the JMAP TeamMailer adapter. Owns all the email vendor
// detail: the configured-check, the copy, and the transport call. Swapping the
// channel = swapping this file; nothing that depends on the TeamMailer port
// changes.
//
// The markup is the shared email design system's (lib/server/email/layout), the
// same shell the notification mails use — an invite is usually the first thing a
// new person ever sees from the product, and it shouldn't be the one mail that
// looks like it came from somewhere else.

import { EmailTransport } from "@/lib/server/email/EmailTransport"
import { appUrl, bullets, callout, keyValues, paragraph, plainText, renderEmail, sectionTitle } from "@/lib/server/email/layout"
import type { TeamRole } from "@/lib/shared/types"

import type { InviteMessage, RemovedFromTeamMessage, RoleChangedMessage, TeamMailer } from "../ports/TeamMailer"

/** What each role may do, in the words the invitee needs — an invite that only
 *  says "as admin" makes the person guess what they just agreed to. */
const ROLE_BLURB: Record<TeamRole, string> = {
    owner: "Owners have full control: projects, members, billing and team settings.",
    admin: "Admins can add and remove projects and members, and manage team settings.",
    member: "Members work on the projects and collections they've been given access to.",
}

/** Build the invite mail. Pure — separate from the send so the template can be
 *  rendered and reviewed without a transport (scripts/email-preview.ts). */
export function renderInviteEmail(message: InviteMessage): { subject: string; html: string; text: string } {
    const who = message.inviterName ? `${message.inviterName} invited you` : "You've been invited"
    const subject = `${who} to join ${message.teamName} on Ucelot`
    const heading = message.inviterName
        ? `${message.inviterName} invited you to ${message.teamName}`
        : `You've been invited to ${message.teamName}`

    const html = renderEmail({
        preheader: `Join ${message.teamName} on Ucelot as ${message.role}.`,
        kicker: "Team invitation",
        heading,
        subheading: `Joining as ${message.role}`,
        chips: [{ label: message.role, tone: "ember" }],
        blocks: [
            paragraph(
                `Ucelot indexes your team's repositories into a knowledge base, then reviews pull requests and triages issues against ` +
                    "the real code. Accept the invitation and you'll see everything the team has shared with you.",
                { lead: true },
            ),
            callout({ title: message.teamName, body: ROLE_BLURB[message.role] ?? "", tone: "neutral" }),
            sectionTitle("Once you're in"),
            bullets([
                "Grounded pull request reviews on the team's repositories.",
                "Issue tracking that catches duplicates as they're written.",
                "Ask questions about any indexed codebase — in the app or in your editor over MCP.",
            ]),
            keyValues([
                { label: "Team", value: message.teamName },
                { label: "Your role", value: message.role },
                { label: "Invited by", value: message.inviterName ?? "" },
            ]),
        ],
        action: { label: "Accept the invitation", url: message.acceptUrl },
        footerNote: "If you weren't expecting this invitation you can ignore this email — nothing happens until you accept.",
    })

    const text = plainText([
        heading,
        "",
        `${who} to join the team "${message.teamName}" on Ucelot as ${message.role}.`,
        ROLE_BLURB[message.role] ?? null,
        "",
        "Accept the invitation:",
        message.acceptUrl,
        "",
        "If you weren't expecting this invitation you can ignore this email.",
        "",
        "— Ucelot",
    ])

    return { subject, html, text }
}

/** Build the role-changed mail. Pure; see renderInviteEmail. */
export function renderRoleChangedEmail(message: RoleChangedMessage): { subject: string; html: string; text: string } {
    const promoted = RANK[message.current] > RANK[message.previous]
    const heading = `You're now ${article(message.current)} ${message.current} of ${message.teamName}`
    const by = message.actorName ? ` by ${message.actorName}` : ""

    const html = renderEmail({
        preheader: `Your role in ${message.teamName} changed from ${message.previous} to ${message.current}.`,
        kicker: "Team role",
        heading,
        subheading: message.teamName,
        chips: [
            { label: message.previous, tone: "neutral" },
            { label: `now ${message.current}`, tone: promoted ? "positive" : "warning" },
        ],
        blocks: [
            paragraph(
                promoted
                    ? `Your role in ${message.teamName} was raised from ${message.previous} to ${message.current}${by}. Here's what that gives you.`
                    : `Your role in ${message.teamName} was changed from ${message.previous} to ${message.current}${by}. Here's what that means now.`,
                { lead: true },
            ),
            callout({ title: `As ${article(message.current)} ${message.current}`, body: ROLE_BLURB[message.current] ?? "", tone: "neutral" }),
            keyValues([
                { label: "Team", value: message.teamName },
                { label: "Previous role", value: message.previous },
                { label: "New role", value: message.current },
                { label: "Changed by", value: message.actorName ?? "" },
            ]),
        ],
        action: teamsUrl() ? { label: "Open the team", url: teamsUrl() } : null,
        footerNote: "If this wasn't expected, talk to a team owner — roles can only be changed by an admin or an owner.",
    })

    const text = plainText([
        heading,
        "",
        `Your role in ${message.teamName} was changed from ${message.previous} to ${message.current}${by}.`,
        ROLE_BLURB[message.current] ?? null,
        "",
        teamsUrl() ? "Open the team:" : null,
        teamsUrl() || null,
        "",
        "If this wasn't expected, talk to a team owner — roles can only be changed by an admin or an owner.",
        "",
        "— Ucelot",
    ])

    return { subject: heading, html, text }
}

/** Build the removed-from-team mail. Pure; see renderInviteEmail. */
export function renderRemovedFromTeamEmail(message: RemovedFromTeamMessage): { subject: string; html: string; text: string } {
    const heading = `You were removed from ${message.teamName}`
    const by = message.actorName ? ` by ${message.actorName}` : ""

    const html = renderEmail({
        preheader: `You no longer have access to ${message.teamName} on Ucelot.`,
        kicker: "Team access",
        heading,
        subheading: message.teamName,
        chips: [{ label: "access removed", tone: "critical" }],
        blocks: [
            paragraph(
                `Your membership of ${message.teamName} on Ucelot ended${by}. Its projects, reviews and issues are no longer visible to you.`,
                { lead: true },
            ),
            // What SURVIVES matters as much as what stopped: someone removed from
            // a team can reasonably fear their own account went with it.
            callout({
                title: "Your account is unaffected",
                body: "You keep your Ucelot account and any other teams you belong to. Nothing you wrote was deleted — it stays with the team, which is what owns it.",
                tone: "neutral",
            }),
        ],
        action: appUrl("/projects") ? { label: "Open Ucelot", url: appUrl("/projects") } : null,
        footerNote: "If this looks like a mistake, ask a team owner to invite you again.",
    })

    const text = plainText([
        heading,
        "",
        `Your membership of ${message.teamName} on Ucelot ended${by}. Its projects, reviews and issues are no longer visible to you.`,
        "",
        "Your account is unaffected — you keep it and any other teams you belong to. Nothing you wrote was deleted; it stays with the team, which owns it.",
        "",
        "If this looks like a mistake, ask a team owner to invite you again.",
        "",
        "— Ucelot",
    ])

    return { subject: heading, html, text }
}

/** Ranked so a change can be described as a promotion or a demotion — the two
 *  read very differently and the mail should not be neutral about which it is. */
const RANK: Record<TeamRole, number> = { member: 0, admin: 1, owner: 2 }

const article = (role: TeamRole) => (role === "admin" || role === "owner" ? "an" : "a")

// The team page is at /team (app/(app)/team), not under /settings.
const teamsUrl = () => appUrl("/team")

/** Delivers team mail over the app's JMAP transport. No-ops when email is
 *  unconfigured (same posture as the notification emails). Construct via the
 *  composition root. */
export class JmapTeamMailer implements TeamMailer {
    private readonly mail = new EmailTransport()

    async sendInvite(message: InviteMessage): Promise<void> {
        // The invite alone PROPAGATES a failure: it is the whole point of the
        // request that triggered it, and an invite row nobody was told about is
        // worse than an error the sender can act on. The two below are
        // after-the-fact notices about a change that has already committed.
        if (!this.mail.isConfigured()) return
        const mail = renderInviteEmail(message)
        await this.mail.send({ to: message.to, subject: mail.subject, html: mail.html, text: mail.text })
    }

    async sendRoleChanged(message: RoleChangedMessage): Promise<void> {
        await this.deliver(message.to, () => renderRoleChangedEmail(message), "role-changed")
    }

    async sendRemovedFromTeam(message: RemovedFromTeamMessage): Promise<void> {
        await this.deliver(message.to, () => renderRemovedFromTeamEmail(message), "removed")
    }

    private async deliver(to: string, build: () => { subject: string; html: string; text: string }, what: string): Promise<void> {
        if (!this.mail.isConfigured() || !to) return
        try {
            const built = build()
            await this.mail.send({ to, subject: built.subject, html: built.html, text: built.text })
        } catch (e) {
            console.error(`[teams] ${what} email failed:`, (e as Error).message)
        }
    }
}
