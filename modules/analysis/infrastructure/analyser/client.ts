// Shared core for the bobby-analyser client: env config, auth header, the error
// type. Every endpoint module imports from here. Token is server-only — never
// ship it to the browser. See bobby-analyser/docs/subsystems/server.md.

const ANALYSER_URL = process.env.BOBBY_ANALYSER_URL || ""
export const ANALYSER_TOKEN = process.env.BOBBY_ANALYSER_TOKEN || ""

export class AnalyserError extends Error {
    constructor(message: string, public readonly code: string = "analyser_error") {
        super(message)
    }
}

export function assertConfigured(): { http: string; ws: string } {
    if (!ANALYSER_URL) {
        throw new AnalyserError("BOBBY_ANALYSER_URL is not set", "not_configured")
    }
    const http = ANALYSER_URL.replace(/\/+$/, "")
    const ws = http.replace(/^http/, "ws")
    return { http, ws }
}

export function authHeader(): Record<string, string> {
    return ANALYSER_TOKEN ? { Authorization: `Bearer ${ANALYSER_TOKEN}` } : {}
}
