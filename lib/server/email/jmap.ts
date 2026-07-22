// Email transport via Stalwart's JMAP API (RFC 8620 core + RFC 8621 mail/
// submission). It's plain HTTPS + JSON — no raw sockets — which is the right
// shape for the Worker runtime: it mirrors lib/github-app.ts's fetch posture
// (explicit User-Agent, module-level config, best-effort) and, unlike the old
// SMTP-over-cloudflare:sockets path, it also runs as-is under `next dev`.
//
// Sending is: bootstrap the JMAP session once (apiUrl + mail accountId + Drafts
// mailbox, cached per isolate), then one request that Email/set-creates a draft
// and EmailSubmission/set-submits it, destroying the draft on success.

export interface MailMessage {
    to: string
    subject: string
    /** HTML body (primary alternative). */
    html: string
    /** Plain-text fallback. */
    text: string
}

export class EmailError extends Error {
    constructor(message: string) {
        super(message)
        this.name = "EmailError"
    }
}

const USER_AGENT = "ucelot-tracker"

// ─── config ─────────────────────────────────────────────────────────────────

interface JmapConfig {
    sessionUrl: string
    authHeader: string
    from: { name?: string; email: string }
}

// jmapConfig reads STALWART_* from the environment at call time. Returns null
// when unconfigured (or missing auth / from) so callers no-op instead of throwing.
function jmapConfig(): JmapConfig | null {
    const base = process.env.STALWART_JMAP_URL?.trim()
    if (!base) return null

    const token = process.env.STALWART_JMAP_TOKEN?.trim()
    const user = process.env.STALWART_JMAP_USER?.trim()
    const pass = process.env.STALWART_JMAP_PASS
    const authHeader = token
        ? `Bearer ${token}`
        : user && pass != null
          ? `Basic ${btoa(`${user}:${pass}`)}`
          : ""
    if (!authHeader) return null

    const fromRaw = process.env.EMAIL_FROM?.trim() || user
    if (!fromRaw) return null

    // Accept either a base host ("https://mail.example.com") or a full session /
    // .well-known URL; derive the JMAP session endpoint from a bare host.
    const sessionUrl =
        /\/(\.well-known\/jmap|jmap|session)\/?$/.test(base) || base.includes("/.well-known/")
            ? base
            : `${base.replace(/\/+$/, "")}/.well-known/jmap`

    return { sessionUrl, authHeader, from: parseAddress(fromRaw) }
}

// isEmailConfigured is the cheap gate callers check before doing any work.
export function isEmailConfigured(): boolean {
    return jmapConfig() !== null
}

// ─── session ────────────────────────────────────────────────────────────────

interface Session {
    apiUrl: string
    accountId: string
    draftsMailboxId: string
    /** Identity to send as — JMAP EmailSubmission requires it (Stalwart rejects
     *  submissions without one). Matched to EMAIL_FROM, else the first identity. */
    identityId: string
}

// Cached per isolate — apiUrl/accountId/Drafts are stable. Cleared on send
// failure so a later attempt re-bootstraps rather than reusing a bad session.
let sessionCache: Session | null = null

async function getSession(cfg: JmapConfig): Promise<Session> {
    if (sessionCache) return sessionCache

    const res = await fetch(cfg.sessionUrl, {
        headers: { Authorization: cfg.authHeader, Accept: "application/json", "User-Agent": USER_AGENT },
        cache: "no-store",
    })
    if (!res.ok) throw new EmailError(`JMAP session failed: HTTP ${res.status} ${await snippet(res)}`)

    const session = (await res.json()) as {
        apiUrl?: string
        primaryAccounts?: Record<string, string>
    }
    if (!session.apiUrl) throw new EmailError("JMAP session has no apiUrl")
    const apiUrl = new URL(session.apiUrl, cfg.sessionUrl).toString()
    const accountId = session.primaryAccounts?.["urn:ietf:params:jmap:mail"]
    if (!accountId) throw new EmailError("JMAP session has no mail account (urn:ietf:params:jmap:mail)")

    const { draftsMailboxId, identityId } = await loadAccountRefs(cfg, apiUrl, accountId)
    sessionCache = { apiUrl, accountId, draftsMailboxId, identityId }
    return sessionCache
}

// loadAccountRefs fetches, in one request, the Drafts mailbox (Email/set needs a
// mailbox) and a sending Identity (EmailSubmission/set needs identityId). Both
// use ids:null to return the full — small — set. Drafts is picked by role; the
// identity is matched to EMAIL_FROM, falling back to the first available.
async function loadAccountRefs(
    cfg: JmapConfig,
    apiUrl: string,
    accountId: string,
): Promise<{ draftsMailboxId: string; identityId: string }> {
    const data = await jmapCall(cfg, apiUrl, {
        using: ["urn:ietf:params:jmap:core", "urn:ietf:params:jmap:mail", "urn:ietf:params:jmap:submission"],
        methodCalls: [
            ["Mailbox/get", { accountId, ids: null, properties: ["id", "role"] }, "mb"],
            ["Identity/get", { accountId, ids: null, properties: ["id", "email"] }, "id"],
        ],
    })
    const responses = data.methodResponses ?? []
    const args = (tag: string) => responses.find((r) => r[2] === tag)?.[1]

    const mailboxes = args("mb")?.list as { id: string; role: string | null }[] | undefined
    const drafts = mailboxes?.find((m) => m.role === "drafts")
    if (!drafts) throw new EmailError("no Drafts mailbox found for the JMAP account")

    const identities = args("id")?.list as { id: string; email: string }[] | undefined
    if (!identities?.length) throw new EmailError("no sending identity found for the JMAP account")
    const identity =
        identities.find((i) => i.email?.toLowerCase() === cfg.from.email.toLowerCase()) ?? identities[0]

    return { draftsMailboxId: drafts.id, identityId: identity.id }
}

// ─── send ───────────────────────────────────────────────────────────────────

export async function sendMail(msg: MailMessage): Promise<void> {
    const cfg = jmapConfig()
    if (!cfg) throw new EmailError("Stalwart JMAP is not configured (set STALWART_JMAP_URL + auth + EMAIL_FROM)")

    try {
        const session = await getSession(cfg)
        const rcpts = parseRecipients(msg.to)
        if (!rcpts.length) throw new EmailError(`no valid recipient in "${msg.to}"`)

        const data = await jmapCall(cfg, session.apiUrl, {
            using: [
                "urn:ietf:params:jmap:core",
                "urn:ietf:params:jmap:mail",
                "urn:ietf:params:jmap:submission",
            ],
            methodCalls: [
                [
                    "Email/set",
                    {
                        accountId: session.accountId,
                        create: {
                            draft: {
                                mailboxIds: { [session.draftsMailboxId]: true },
                                keywords: { $draft: true, $seen: true },
                                from: [cfg.from],
                                to: rcpts,
                                subject: msg.subject,
                                // The server MIME-encodes headers + bodies, so we pass
                                // structured values (no manual encoded-words / base64).
                                bodyStructure: {
                                    type: "multipart/alternative",
                                    subParts: [
                                        { partId: "text", type: "text/plain" },
                                        { partId: "html", type: "text/html" },
                                    ],
                                },
                                bodyValues: {
                                    text: { value: msg.text },
                                    html: { value: msg.html },
                                },
                            },
                        },
                    },
                    "c1",
                ],
                [
                    "EmailSubmission/set",
                    {
                        accountId: session.accountId,
                        // Don't leave the draft behind once it's sent.
                        onSuccessDestroyEmail: ["#sendIt"],
                        create: {
                            sendIt: {
                                emailId: "#draft", // back-ref to the Email/set create above
                                identityId: session.identityId,
                                envelope: {
                                    mailFrom: { email: cfg.from.email },
                                    rcptTo: rcpts.map((r) => ({ email: r.email })),
                                },
                            },
                        },
                    },
                    "c2",
                ],
            ],
        })
        assertSendOk(data)
    } catch (err) {
        sessionCache = null // force re-bootstrap next time
        throw err
    }
}

// ─── jmap plumbing ──────────────────────────────────────────────────────────

type JmapResponse = { methodResponses?: [string, Record<string, unknown>, string][] }

async function jmapCall(cfg: JmapConfig, apiUrl: string, body: unknown): Promise<JmapResponse> {
    const res = await fetch(apiUrl, {
        method: "POST",
        headers: {
            Authorization: cfg.authHeader,
            "Content-Type": "application/json",
            Accept: "application/json",
            "User-Agent": USER_AGENT,
        },
        body: JSON.stringify(body),
        cache: "no-store",
    })
    if (!res.ok) throw new EmailError(`JMAP request failed: HTTP ${res.status} ${await snippet(res)}`)
    return (await res.json()) as JmapResponse
}

// assertSendOk turns a JMAP-level failure (top-level error, notCreated, or a
// missing submission) into a thrown EmailError with the server's reason.
function assertSendOk(data: JmapResponse): void {
    const responses = data.methodResponses ?? []
    const err = responses.find((r) => r[0] === "error")
    if (err) throw new EmailError(`JMAP error: ${JSON.stringify(err[1])}`)

    const byTag = (tag: string) => responses.find((r) => r[2] === tag)?.[1]
    const emailSet = byTag("c1")
    const notCreatedEmail = (emailSet?.notCreated as Record<string, unknown> | undefined)?.draft
    if (notCreatedEmail) throw new EmailError(`Email/set failed: ${JSON.stringify(notCreatedEmail)}`)

    const subSet = byTag("c2")
    const notCreatedSub = (subSet?.notCreated as Record<string, unknown> | undefined)?.sendIt
    if (notCreatedSub) throw new EmailError(`EmailSubmission/set failed: ${JSON.stringify(notCreatedSub)}`)
    const created = (subSet?.created as Record<string, unknown> | undefined)?.sendIt
    if (!created) throw new EmailError(`EmailSubmission not created: ${JSON.stringify(subSet ?? "no response")}`)
}

// ─── helpers ────────────────────────────────────────────────────────────────

function parseAddress(raw: string): { name?: string; email: string } {
    const m = raw.match(/^\s*(.*?)\s*<([^>]+)>\s*$/)
    if (m) {
        const name = m[1].replace(/^"|"$/g, "").trim()
        return name ? { name, email: m[2].trim() } : { email: m[2].trim() }
    }
    return { email: raw.trim() }
}

function parseRecipients(to: string): { email: string; name?: string }[] {
    return to
        .split(",")
        .map((s) => parseAddress(s))
        .filter((a) => a.email)
}

async function snippet(res: Response): Promise<string> {
    try {
        return (await res.text()).slice(0, 300)
    } catch {
        return ""
    }
}
