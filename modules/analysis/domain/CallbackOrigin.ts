// Where the analyser should call back to.
//
// The detached analysis flow hands the analyser a callback URL, and until now
// that URL was built from the INCOMING request's origin. That is right in
// production — the request arrives at the public hostname, so the analyser is
// told the public hostname — and silently wrong everywhere else. Running the
// tracker locally against a remote analyser tells that analyser to POST to
// `http://localhost:3000`, which from inside its container is ITSELF:
//
//     dial tcp [::1]:3000: connect: connection refused
//
// The analysis itself succeeds. The work is done and paid for; only the result
// is lost, ~20s later, in the analyser's log rather than the tracker's. Nothing
// surfaces in the UI except a suggestion that never arrives.
//
// BOBBY_CALLBACK_ORIGIN overrides the derived origin. It is optional and should
// stay unset in a normal deployment, where the request origin is already right.

/** A loopback origin can never be reached by a process on another host. */
export function isLoopbackOrigin(origin: string): boolean {
    try {
        const host = new URL(origin).hostname.toLowerCase()
        return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]" || host.endsWith(".localhost")
    } catch {
        return false
    }
}

/** The origin to hand the analyser: the configured public origin when set,
 *  otherwise the request's own. Trailing slashes trimmed so callers can append
 *  a path without doubling the separator. */
export function callbackOrigin(requestOrigin: string): string {
    const configured = process.env.BOBBY_CALLBACK_ORIGIN?.trim()
    return (configured || requestOrigin).replace(/\/+$/, "")
}

/** True when this pairing cannot possibly work: a loopback callback handed to an
 *  analyser that is not on this host. Worth detecting at dispatch, because the
 *  alternative is a warning in someone else's log after the work is finished. */
export function callbackIsUnreachable(callbackUrl: string, analyserBaseUrl: string): boolean {
    return isLoopbackOrigin(callbackUrl) && !isLoopbackOrigin(analyserBaseUrl)
}
