// Structured tracing for the regional analysis path.
//
// This exists because the failure mode here is invisible: a request bound to the
// wrong database reads nothing, writes nothing that matches, and returns 200.
// Every layer reports success and the result simply is not there afterwards.
// Guessing which layer did it from the outside does not work — the whole point of
// these lines is that the next run answers it.
//
// One line per decision, JSON, all tagged so a single grep gets the story:
//
//     wrangler tail --format=pretty | grep bobby.trace
//
// NEVER log a service-role key. Databases are identified by their Supabase
// project ref (the subdomain), which says WHICH database without carrying a
// credential.

/** `https://kayshdvbxnmywgflqhgh.supabase.co` → `kayshdvbxnmywgflqhgh`. */
export function dbRef(url: string | undefined | null): string {
    if (!url) return "none"
    try {
        return new URL(url).hostname.split(".")[0] || "unknown"
    } catch {
        return "unparseable"
    }
}

/** One traced decision. Keep `event` stable — these are grep targets. */
export function trace(event: string, fields: Record<string, unknown> = {}): void {
    try {
        console.log(JSON.stringify({ tag: "bobby.trace", event, ...fields }))
    } catch {
        // Never let a logging failure break the request it is describing.
        console.log(JSON.stringify({ tag: "bobby.trace", event, note: "fields unserialisable" }))
    }
}
