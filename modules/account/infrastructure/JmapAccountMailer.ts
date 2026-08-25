// Account infrastructure — the JMAP AccountMailer adapter. Owns the copy and the
// transport for the welcome and farewell mails.
//
// Both swallow every failure. That is not the usual best-effort hedge: for the
// welcome, onboarding has already committed and there is nothing to roll back;
// for the farewell, the account is being destroyed in the same request, so a
// thrown error would turn a successful deletion into a 500 the user cannot
// retry — the identity it needed is gone.

import { EmailTransport } from "@/lib/server/email/EmailTransport"
import { appUrl, bullets, callout, paragraph, plainText, renderEmail, sectionTitle } from "@/lib/server/email/layout"

import type { AccountMailer, FarewellMessage, WelcomeMessage } from "../ports/AccountMailer"

/** Build the welcome mail. Pure — split from the send so the template can be
 *  rendered and reviewed without a transport (scripts/email-preview.ts). */
export function renderWelcomeEmail(message: WelcomeMessage): { subject: string; html: string; text: string } {
    const first = firstName(message.name)
    const heading = first ? `Welcome aboard, ${first}` : "Welcome aboard"
    const projects = appUrl("/projects")

    const html = renderEmail({
        preheader: "Point Ucelot at a repository and it'll read the whole thing. Everything good starts there.",
        kicker: "Welcome",
        heading,
        subheading: message.teamName ? `Your workspace: ${message.teamName}` : null,
        chips: [{ label: "account ready", tone: "positive" }],
        blocks: [
            paragraph(
                "Right now Ucelot knows nothing about your code — and that's the only thing standing between you and the good part. " +
                    "Point it at a repository and it reads the whole thing: how your code is actually written, who calls what, which " +
                    "tests cover it. After that, every review it writes is grounded in your codebase instead of a guess about it.",
                { lead: true },
            ),
            sectionTitle("Here's the fun bit"),
            bullets([
                "Add a project and point it at a repo — GitHub or GitLab, public or private.",
                "Ucelot reads it end to end and builds the knowledge base. You'll get an email the moment it's ready.",
                "Open a pull request. The review that comes back cites real callers, real precedents, real tests.",
                "Wondering how something works? Just ask — in the app, or from your editor over MCP.",
            ]),
            message.teamName
                ? callout({
                      title: message.teamName,
                      body: "Your workspace. Bring your teammates in from Settings whenever you like — projects, reviews and collections are all shared across it.",
                      tone: "neutral",
                  })
                : "",
            paragraph("Glad to have you here. Go and connect that first repo — it's the best five minutes you'll spend today."),
        ],
        action: projects ? { label: "Add your first project", url: projects } : null,
        footerNote: "Ucelot is AI-assisted and can make mistakes — verify findings before acting on them.",
    })

    const text = plainText([
        heading,
        "",
        "Right now Ucelot knows nothing about your code — and that's the only thing standing between you and the good part. Point it at a repository and it reads the whole thing: how your code is actually written, who calls what, which tests cover it. After that, every review it writes is grounded in your codebase instead of a guess about it.",
        message.teamName ? `Your workspace: ${message.teamName}` : null,
        "",
        "Here's the fun bit:",
        "- Add a project and point it at a repo (GitHub or GitLab, public or private).",
        "- Ucelot reads it end to end — you'll get an email the moment it's ready.",
        "- Open a pull request. The review cites real callers, precedents and tests.",
        "- Wondering how something works? Just ask, in the app or over MCP.",
        "",
        "Glad to have you here. Go and connect that first repo — it's the best five minutes you'll spend today.",
        "",
        projects ? "Add your first project:" : null,
        projects || null,
        "",
        "— Ucelot",
    ])

    return { subject: heading, html, text }
}

/** Build the farewell mail. Pure; see renderWelcomeEmail.
 *
 *  Two jobs at once, and the warmth must not cost the accuracy: it is a kind
 *  goodbye, AND it is the only receipt that will ever exist for an irreversible
 *  action the person can no longer sign in to check. So the tone is soft and the
 *  facts stay exact — which teams went, which survive, and what was kept. */
export function renderFarewellEmail(message: FarewellMessage): { subject: string; html: string; text: string } {
    const first = firstName(message.name)
    const heading = first ? `Until next time, ${first}` : "Until next time"
    const home = appUrl()

    const blocks: string[] = [
        paragraph(
            "Sometimes you need to go and discover new things — no hard feelings at all. Your account and everything it owned have " +
                "been deleted, exactly as you asked. Here's the receipt, since there's no longer an account to sign in and check.",
            { lead: true },
        ),
    ]

    // Naming the teams matters more here than anywhere else in the product: this
    // is the only record the person will ever have of what the button did.
    if (message.teamsDeleted.length) {
        blocks.push(sectionTitle("Deleted with your account"))
        blocks.push(bullets(message.teamsDeleted.map((t) => `${t} — its projects, issues, pull request history and knowledge bases`), { tone: "critical" }))
    }
    if (message.teamsLeft.length) {
        blocks.push(sectionTitle("Carrying on without you"))
        blocks.push(bullets(message.teamsLeft, { tone: "neutral" }))
    }

    blocks.push(sectionTitle("What we kept"))
    blocks.push(
        bullets(
            [
                "A usage record, tied to a one-way hash of this address — no personal data, no content. It only stops a fresh sign-up from resetting a monthly allowance.",
                "Any beta invitation sent here. It was issued to the address rather than the account, so withdrawing it quietly wouldn't be fair.",
                // Same list, same marker — but greyed, because the two above are
                // disclosures about data and this one is a joke. The colour is
                // the only thing separating them, and it is enough.
                { text: keepsake(message.to), dim: true },
            ],
            { tone: "neutral" },
        ),
    )

    blocks.push(
        paragraph(
            "If you ever want to pick it up again, you're welcome back any time — signing up on this address is all it takes. " +
                "Thanks for giving Ucelot a go, and good luck with whatever's next.",
        ),
    )

    const html = renderEmail({
        preheader: "Your account has been deleted, as you asked. You're welcome back any time.",
        kicker: "Account closed",
        heading,
        subheading: message.to,
        chips: [{ label: "account closed", tone: "neutral" }],
        blocks,
        action: home ? { label: "Come back any time", url: home } : null,
        footerNote: "This is the last email we'll send to this address unless you sign up again.",
    })

    const text = plainText([
        heading,
        "",
        "Sometimes you need to go and discover new things — no hard feelings at all. Your account and everything it owned have been deleted, exactly as you asked. Here's the receipt, since there's no longer an account to sign in and check.",
        "",
        message.teamsDeleted.length ? "Deleted with your account:" : null,
        ...message.teamsDeleted.map((t) => `- ${t} (projects, issues, pull request history, knowledge bases)`),
        "",
        message.teamsLeft.length ? "Carrying on without you:" : null,
        ...message.teamsLeft.map((t) => `- ${t}`),
        "",
        "What we kept:",
        "- A usage record, tied to a one-way hash of this address — no personal data, no content. It only stops a fresh sign-up from resetting a monthly allowance.",
        "- Any beta invitation sent here. It was issued to the address rather than the account.",
        `- ${keepsake(message.to)}`,
        "",
        "If you ever want to pick it up again, you're welcome back any time — signing up on this address is all it takes. Thanks for giving Ucelot a go, and good luck with whatever's next.",
        "",
        "— Ucelot",
    ])

    // The SUBJECT stays factual while the heading is warm: this is a record
    // people search their inbox for months later, and "Until next time" is not
    // what they will type into the search box.
    return { subject: "Your Ucelot account has been deleted", html, text }
}

/** Delivers account lifecycle mail over the app's JMAP transport. No-ops when
 *  email is unconfigured. Construct via the composition root. */
export class JmapAccountMailer implements AccountMailer {
    private readonly mail = new EmailTransport()

    async sendWelcome(message: WelcomeMessage): Promise<void> {
        await this.deliver(message.to, () => renderWelcomeEmail(message), "welcome")
    }

    async sendFarewell(message: FarewellMessage): Promise<void> {
        await this.deliver(message.to, () => renderFarewellEmail(message), "farewell")
    }

    private async deliver(to: string, build: () => { subject: string; html: string; text: string }, what: string): Promise<void> {
        if (!this.mail.isConfigured() || !to) return
        try {
            const built = build()
            await this.mail.send({ to, subject: built.subject, html: built.html, text: built.text })
        } catch (e) {
            // Logged, never rethrown — see the file header for why this one
            // swallows rather than propagating.
            console.error(`[account] ${what} email failed:`, (e as Error).message)
        }
    }
}

/** The last line of "what we kept" — the one that isn't a disclosure.
 *
 *  Every entry says out loud that it ISN'T stored anywhere. That is the whole
 *  reason a joke is safe in this particular mail: the section above it is a
 *  deletion receipt, and a warm line that could be misread as "…and we also held
 *  on to some of your data" would undo exactly the trust the receipt is there to
 *  build. */
const KEEPSAKES = [
    "The memories, obviously — and those live nowhere near a database.",
    "A fondness for whichever repo you connected first. Not stored, just felt.",
    "The memory of your first all-green review. No table required.",
    "Quiet respect for every commit message you actually wrote properly. Not a row anywhere.",
    "A soft spot for the pull request you rewrote four times. Nowhere on disk.",
    "The good bits. We never got round to putting those behind a migration.",
] as const

/** Pick one, SEEDED BY THE ADDRESS rather than at random.
 *
 *  Random would make the template impure: the same farewell would render
 *  differently on every call, so the preview, the tests and any re-render would
 *  all disagree. Seeding on the recipient keeps it varied between people — which
 *  is the playful part — while staying the same line for the same person, every
 *  time. (FNV-1a, for spread across a six-item list; nothing here is a secret.) */
function keepsake(address: string): string {
    let hash = 0x811c9dc5
    for (let i = 0; i < address.length; i++) {
        hash ^= address.charCodeAt(i)
        hash = Math.imul(hash, 0x01000193) >>> 0
    }
    return KEEPSAKES[hash % KEEPSAKES.length]
}

function firstName(name: string | null): string | null {
    const first = (name ?? "").trim().split(/\s+/)[0]
    return first || null
}
