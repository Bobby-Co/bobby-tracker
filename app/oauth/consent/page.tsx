import { redirect } from "next/navigation"
import { Supabase } from "@/lib/server/supabase"
import {
    AuthorizationRequest,
    ConsentCsrf,
    ConsentServerSecret,
    OAuthServerConfig,
    getOAuthAuthorizationService,
    type AuthorizeQuery,
} from "@/modules/mcp-oauth"

// GET /oauth/consent — the human step of the authorization code flow.
//
// Reached from /oauth/authorize (app/oauth/authorize/route.ts), which is the
// endpoint clients are told about and which owns the signed-out bounce. The
// session check below is still made: this URL is directly reachable, and a page
// that assumes an upstream guard ran is a page that stops being safe the moment
// someone links to it.
//
// DELIBERATELY OUTSIDE app/(app). This is an account-authorization screen shown
// to someone arriving from another application — the dashboard chrome (sidebar,
// team switcher, project nav) is noise at best and misleading at worst, since the
// decision is about granting access, not navigating the product. Sitting at the
// top level alongside /login and /invite also means it renders under the root
// layout alone, with no client-side auth guard between the request and the form.
//
// HOW FAILURES ARE REPORTED is the security-critical part and it is not uniform;
// AuthorizationRequest.validate decides. In short: if the client_id is unknown or
// the redirect_uri isn't registered, we render an error HERE and redirect
// nowhere — sending an error to an unverified redirect_uri would make this
// endpoint an open redirector. Once the redirect_uri is proven registered, later
// errors DO go back to it, because a client that gets `?error=…` can recover
// while a client that gets nothing just hangs.

export default async function ConsentPage({
    searchParams,
}: {
    searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
    const params = await searchParams

    // Belt and braces — /oauth/authorize normally handles this, and re-entering
    // through it (rather than jumping back here) keeps the bounce idempotent.
    const user = await Supabase.currentUser()
    if (!user) redirect(`/login?next=${encodeURIComponent(`/oauth/authorize?${queryString(params)}`)}`)

    if (!OAuthServerConfig.isConfigured()) {
        return (
            <ConsentError
                title="Authorization isn't available"
                message="This deployment has no public URL configured, so it can't complete an OAuth flow. Ask an administrator to set NEXT_PUBLIC_APP_URL."
            />
        )
    }

    // Refuse to render a form we can't protect rather than minting a forgeable
    // token — an unprotected Approve button is worse than an unavailable one.
    if (!ConsentServerSecret.isConfigured()) {
        return (
            <ConsentError
                title="Authorization isn't available"
                message="This deployment has no server secret configured, so the consent form can't be secured. Ask an administrator to set SUPABASE_SERVICE_ROLE_KEY (or MCP_CONSENT_SECRET)."
            />
        )
    }

    // A repeated parameter is ambiguous (RFC 6749 §3.1). Refusing beats guessing —
    // guessing is how a smuggled second `redirect_uri` gets honoured.
    if (Object.values(params).some((v) => Array.isArray(v))) {
        return (
            <ConsentError
                title="This authorization link is malformed"
                message="One of its parameters appears more than once, so the request can't be interpreted safely."
            />
        )
    }

    const query: AuthorizeQuery = {
        clientId: one(params.client_id),
        redirectUri: one(params.redirect_uri),
        responseType: one(params.response_type),
        codeChallenge: one(params.code_challenge),
        codeChallengeMethod: one(params.code_challenge_method),
        scope: one(params.scope),
        state: one(params.state),
        resource: one(params.resource),
    }

    const described = await getOAuthAuthorizationService().describe(query)

    if (!described.ok) {
        const fault = described.fault
        // Proven-registered redirect_uri → tell the client what went wrong.
        if (fault.kind === "redirect") {
            redirect(
                AuthorizationRequest.buildErrorUrl(
                    fault.redirectUri,
                    fault.error,
                    fault.description,
                    fault.state,
                    OAuthServerConfig.issuer(),
                ),
            )
        }
        return <ConsentError title="This request can't be approved" message={fault.message} />
    }

    const request = described.request

    // The anti-CSRF token, derived from the caller's own session cookies and bound
    // to THIS request's client / redirect / PKCE challenge. See domain/ConsentCsrf.
    const csrf = await ConsentCsrf.mint(
        ConsentServerSecret.read(),
        user.id,
        ConsentCsrf.bindingFor({
            clientId: request.clientId,
            redirectUri: request.redirectUri,
            codeChallenge: request.codeChallenge,
        }),
    )

    const account = user.email || (user.user_metadata?.full_name as string) || "your account"
    // Set by POST /api/oauth/authorize when it bounces back here. "retry" = the
    // CSRF token no longer matched (a sign-in refresh mid-consent); "invalid" =
    // re-validation against the client registry failed. Both used to return the
    // user to this screen with no explanation, which read as a dead button.
    const consentError = one(params.consent_error)

    return (
        <div className="flex min-h-full items-center justify-center px-6 py-12">
            <div className="w-full max-w-md rounded-[20px] border border-[color:var(--c-border)] bg-white p-7 shadow-[var(--shadow-card)]">
                <div className="text-[10.5px] font-bold uppercase tracking-[0.18em] text-[color:var(--c-text-muted)]">
                    Authorize access
                </div>
                <h1 className="mt-2 text-[19px] font-bold leading-tight tracking-[-0.01em]">
                    {request.clientName} wants to connect to Ucelot
                </h1>
                <p className="mt-2 text-[13px] text-[color:var(--c-text-muted)]">
                    Signed in as <span className="font-semibold text-[color:var(--c-text)]">{account}</span>
                </p>

                {consentError && (
                    <p
                        role="alert"
                        className="mt-4 rounded-[10px] bg-amber-50 px-3 py-2 text-[12.5px] leading-5 text-amber-900"
                    >
                        {consentError === "invalid"
                            ? "That request couldn't be verified when you submitted it, so it wasn't approved. Nothing was shared. If pressing Approve again doesn't work, start over from the application that sent you here."
                            : "That request couldn't be completed — your sign-in changed while this page was open. Nothing was shared. Press Approve again to continue."}
                    </p>
                )}

                <div className="mt-5 rounded-[14px] border border-[color:var(--c-border)] bg-[color:var(--c-surface-2)] p-4">
                    <div className="text-[12px] font-semibold">If you approve, it will be able to:</div>
                    <ul className="mt-2 space-y-1.5 text-[13px] text-[color:var(--c-text-muted)]">
                        <li>Read the knowledge bases of the projects you&apos;ve enabled for MCP</li>
                        <li>Locate files in those projects</li>
                        <li>Ask questions about them and get answers</li>
                    </ul>
                    <div className="mt-3 text-[12px] text-[color:var(--c-text-muted)]">
                        It cannot create, edit or delete anything, and it can&apos;t see projects you
                        haven&apos;t enabled.
                    </div>
                </div>

                <dl className="mt-4 space-y-1.5 text-[12px]">
                    <div className="flex items-start justify-between gap-3">
                        <dt className="text-[color:var(--c-text-muted)]">Redirects to</dt>
                        <dd className="break-all text-right font-medium">{request.redirectUri}</dd>
                    </div>
                    <div className="flex items-start justify-between gap-3">
                        <dt className="text-[color:var(--c-text-muted)]">Access</dt>
                        <dd className="text-right font-medium">{request.scope}</dd>
                    </div>
                </dl>

                {/* Same-origin POST. The decision route re-validates every field
                    below — they travel through the browser, so they are untrusted
                    input on the way back exactly as they were on the way in. */}
                <form action="/api/oauth/authorize" method="POST" className="mt-6 flex gap-2.5">
                    <input type="hidden" name="csrf" value={csrf} />
                    <input type="hidden" name="client_id" value={request.clientId} />
                    <input type="hidden" name="redirect_uri" value={request.redirectUri} />
                    <input type="hidden" name="response_type" value="code" />
                    <input type="hidden" name="code_challenge" value={request.codeChallenge} />
                    <input type="hidden" name="code_challenge_method" value="S256" />
                    <input type="hidden" name="scope" value={request.scope} />
                    {request.state !== null && <input type="hidden" name="state" value={request.state} />}
                    {request.resource !== null && (
                        <input type="hidden" name="resource" value={request.resource} />
                    )}

                    <button type="submit" name="decision" value="deny" className="btn-ghost flex-1 py-2.5 text-[13.5px]">
                        Deny
                    </button>
                    <button
                        type="submit"
                        name="decision"
                        value="approve"
                        className="btn-primary flex-1 py-2.5 text-[13.5px]"
                    >
                        Approve
                    </button>
                </form>

                <p className="mt-4 text-[11.5px] leading-5 text-[color:var(--c-text-muted)]">
                    You can disconnect this application at any time; doing so stops its access
                    immediately.
                </p>
            </div>
        </div>
    )
}

/** A dead end, on purpose: when we can't trust the redirect_uri we show the user
 *  what happened rather than forwarding them (and the error) onward. */
function ConsentError({ title, message }: { title: string; message: string }) {
    return (
        <div className="flex min-h-full items-center justify-center px-6 py-12">
            <div className="w-full max-w-md rounded-[20px] border border-[color:var(--c-border)] bg-white p-7 shadow-[var(--shadow-card)]">
                <div className="text-[10.5px] font-bold uppercase tracking-[0.18em] text-[color:var(--c-accent)]">
                    Authorization stopped
                </div>
                <h1 className="mt-2 text-[18px] font-bold leading-tight tracking-[-0.01em]">{title}</h1>
                <p className="mt-3 text-[13px] leading-6 text-[color:var(--c-text-muted)]">{message}</p>
                <p className="mt-4 text-[12px] text-[color:var(--c-text-muted)]">
                    Nothing was shared. You can close this window and start again from the application
                    that sent you here.
                </p>
            </div>
        </div>
    )
}

function one(value: string | string[] | undefined): string | undefined {
    return typeof value === "string" ? value : undefined
}

/** Rebuild the original query so the post-login return trip is lossless. */
function queryString(params: Record<string, string | string[] | undefined>): string {
    const search = new URLSearchParams()
    for (const [key, value] of Object.entries(params)) {
        if (typeof value === "string") search.append(key, value)
        else if (Array.isArray(value)) for (const v of value) search.append(key, v)
    }
    return search.toString()
}
