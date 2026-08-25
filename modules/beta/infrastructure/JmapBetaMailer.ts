// Beta infrastructure — the JMAP BetaMailer adapter. Owns the copy and the
// transport for the waitlist confirmation and the access-granted mail.
//
// Both swallow their failures (see the port): the database row is the contract
// in each case, and the mail is the courtesy.

import { EmailTransport } from "@/lib/server/email/EmailTransport"
import { appUrl, bullets, callout, paragraph, plainText, renderEmail, sectionTitle } from "@/lib/server/email/layout"

import type { BetaAccessMessage, BetaMailer, WaitlistJoinedMessage } from "../ports/BetaMailer"

/** Build the waitlist confirmation. Pure — split from the send so the template
 *  can be rendered and reviewed without a transport. */
export function renderWaitlistJoinedEmail(message: WaitlistJoinedMessage): { subject: string; html: string; text: string } {
    const first = firstName(message.name)
    const heading = "You're on the list"

    const html = renderEmail({
        preheader: "You're in the queue for the Ucelot beta. We'll email you the moment your invitation is live.",
        kicker: "Beta waitlist",
        heading,
        subheading: message.to,
        chips: [{ label: "waiting", tone: "warning" }],
        blocks: [
            paragraph(
                first
                    ? `Thanks ${first} — your place in the queue for the Ucelot beta is saved against this address.`
                    : "Your place in the queue for the Ucelot beta is saved against this address.",
                { lead: true },
            ),
            sectionTitle("What happens next"),
            bullets([
                "We open the beta in batches, and we work down the queue in order.",
                "You'll get one more email from us when your invitation is live — that one has a link.",
                "Nothing else is needed from you. Asking again doesn't move you up, and doesn't cost you your place either.",
            ]),
            callout({
                title: null,
                body: "Your account already exists — you can sign in any time. Until the invitation lands you'll see the waiting room rather than the app.",
                tone: "neutral",
            }),
        ],
        action: null,
        footerNote: "You're getting this because this address asked to join the Ucelot beta.",
    })

    const text = plainText([
        heading,
        "",
        "Your place in the queue for the Ucelot beta is saved against this address.",
        "",
        "What happens next:",
        "- We open the beta in batches and work down the queue in order.",
        "- You'll get one more email when your invitation is live — that one has a link.",
        "- Nothing else is needed. Asking again doesn't move you up, or cost you your place.",
        "",
        "Your account already exists and you can sign in any time; until the invitation lands you'll see the waiting room rather than the app.",
        "",
        "— Ucelot",
    ])

    return { subject: `${heading} — Ucelot beta`, html, text }
}

/** Build the access-granted mail. Pure; see above. */
export function renderBetaAccessEmail(message: BetaAccessMessage): { subject: string; html: string; text: string } {
    const heading = "Your Ucelot beta invitation is live"
    const login = appUrl("/login")

    const html = renderEmail({
        preheader: "Your invitation is live — sign in and the app is open.",
        kicker: "Beta access",
        heading,
        subheading: message.to,
        chips: [{ label: "invited", tone: "positive" }],
        blocks: [
            paragraph(
                "You're through. Sign in on this address and you'll land in the app rather than the waiting room.",
                { lead: true },
            ),
            // A real and non-obvious consequence of how the gate works: the flag
            // rides in the access token, so a session opened before the
            // invitation still sees the waiting room until it refreshes. Saying
            // so here costs a sentence and saves a support round trip.
            callout({
                title: "Already signed in?",
                body: "Sign out and back in once. Access travels in your session token, so a session started before the invitation won't see it until it refreshes.",
                tone: "neutral",
            }),
            sectionTitle("Worth doing first"),
            bullets([
                "Add a project and point it at a repository — Ucelot indexes it once.",
                "Open a pull request against it and you'll get a grounded review.",
                "Tell us what's wrong with it. That's what a beta is for.",
            ]),
            // The staff note is an INTERNAL annotation ("design partner",
            // "conference lead"). It is never shown — it wasn't written for
            // the recipient, and some of it would read badly if it were.
        ],
        action: login ? { label: "Sign in to Ucelot", url: login } : null,
        footerNote: "You're getting this because this address was invited to the Ucelot beta.",
    })

    const text = plainText([
        heading,
        "",
        "You're through. Sign in on this address and you'll land in the app rather than the waiting room.",
        "",
        "Already signed in? Sign out and back in once — access travels in your session token, so a session started before the invitation won't see it until it refreshes.",
        "",
        "Worth doing first:",
        "- Add a project and point it at a repository.",
        "- Open a pull request against it and you'll get a grounded review.",
        "- Tell us what's wrong with it. That's what a beta is for.",
        "",
        login ? "Sign in:" : null,
        login || null,
        "",
        "— Ucelot",
    ])

    return { subject: heading, html, text }
}

/** Delivers beta mail over the app's JMAP transport. No-ops when email is
 *  unconfigured. Construct via the composition root. */
export class JmapBetaMailer implements BetaMailer {
    private readonly mail = new EmailTransport()

    async sendWaitlistJoined(message: WaitlistJoinedMessage): Promise<void> {
        await this.deliver(message.to, () => renderWaitlistJoinedEmail(message), "waitlist")
    }

    async sendAccessGranted(message: BetaAccessMessage): Promise<void> {
        await this.deliver(message.to, () => renderBetaAccessEmail(message), "access")
    }

    private async deliver(to: string, build: () => { subject: string; html: string; text: string }, what: string): Promise<void> {
        if (!this.mail.isConfigured() || !to) return
        try {
            const built = build()
            await this.mail.send({ to, subject: built.subject, html: built.html, text: built.text })
        } catch (e) {
            console.error(`[beta] ${what} email failed:`, (e as Error).message)
        }
    }
}

function firstName(name: string | null): string | null {
    const first = (name ?? "").trim().split(/\s+/)[0]
    return first || null
}
