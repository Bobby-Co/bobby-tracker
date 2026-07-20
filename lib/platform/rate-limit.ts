import { getCloudflareContext } from "@opennextjs/cloudflare"
import { jsonError } from "@/lib/api"

// Rate limiting for the UNAUTHENTICATED attack surface (public issue
// submission/AI calls and the relay device-pairing handshake). These routes
// are reachable by anyone holding a public link, so without a limit they allow
// issue spam, relay-code brute force, and unbounded LLM spend ("denial of
// wallet").
//
// Backed by Cloudflare's native rate-limiting bindings (configured in
// wrangler.jsonc as `ratelimits`). The binding is account-scoped and absent
// outside the Workers runtime (local `next dev`, build, tests) — in that case
// we FAIL OPEN (allow) so local development isn't blocked, but log once so the
// gap is visible. In production on Workers the binding is always present.

type RateLimitOutcome = { success: boolean }
type RateLimiter = { limit: (opts: { key: string }) => Promise<RateLimitOutcome> }

// Binding names — keep in sync with wrangler.jsonc `ratelimits[].name`.
export type RateLimitBinding = "PUBLIC_RL" | "RELAY_RL"

let warnedMissing = false

function resolveLimiter(binding: RateLimitBinding): RateLimiter | null {
    try {
        const { env } = getCloudflareContext()
        const candidate = (env as Record<string, unknown>)[binding]
        if (candidate && typeof (candidate as RateLimiter).limit === "function") {
            return candidate as RateLimiter
        }
    } catch {
        // Not running on Workers (dev/build/test) — context unavailable.
    }
    if (!warnedMissing) {
        warnedMissing = true
        console.warn(
            `[rate-limit] binding "${binding}" unavailable — failing open. ` +
                "This is expected in local dev; in production ensure the " +
                "`ratelimits` bindings are configured in wrangler.jsonc.",
        )
    }
    return null
}

// clientKey derives a per-caller bucket from the Cloudflare-verified client IP.
// cf-connecting-ip is set by the edge and not spoofable by the client. The
// `scope` segments distinct routes so one endpoint's traffic can't exhaust
// another's budget.
export function clientKey(request: Request, scope: string): string {
    const ip =
        request.headers.get("cf-connecting-ip") ||
        request.headers.get("x-real-ip") ||
        (request.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() ||
        "unknown"
    return `${scope}:${ip}`
}

// enforceRateLimit returns a 429 Response when the caller is over the limit,
// or null when the request may proceed. Usage:
//
//   const limited = await enforceRateLimit("PUBLIC_RL", clientKey(request, "public-submit"))
//   if (limited) return limited
export async function enforceRateLimit(
    binding: RateLimitBinding,
    key: string,
): Promise<Response | null> {
    const limiter = resolveLimiter(binding)
    if (!limiter) return null // fail open when the binding is absent
    let outcome: RateLimitOutcome
    try {
        outcome = await limiter.limit({ key })
    } catch {
        return null // never let a limiter error take down the route
    }
    if (outcome.success) return null
    const res = jsonError("rate_limited", "Too many requests — please slow down.", 429)
    res.headers.set("Retry-After", "60")
    return res
}
