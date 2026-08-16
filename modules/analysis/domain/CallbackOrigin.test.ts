import { afterEach, describe, expect, test } from "bun:test"
import { callbackIsUnreachable, callbackOrigin, isLoopbackOrigin } from "./CallbackOrigin"

const ORIGINAL = process.env.BOBBY_CALLBACK_ORIGIN
afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.BOBBY_CALLBACK_ORIGIN
    else process.env.BOBBY_CALLBACK_ORIGIN = ORIGINAL
})

describe("callbackOrigin", () => {
    test("uses the request origin when nothing is configured", () => {
        delete process.env.BOBBY_CALLBACK_ORIGIN
        expect(callbackOrigin("https://tracker.example.com")).toBe("https://tracker.example.com")
    })

    test("the configured origin wins — this is the local-dev escape hatch", () => {
        process.env.BOBBY_CALLBACK_ORIGIN = "https://tunnel.example.dev"
        expect(callbackOrigin("http://localhost:3000")).toBe("https://tunnel.example.dev")
    })

    test("a blank or whitespace value is ignored, not treated as an origin", () => {
        // An empty env var is how a deployment "unsets" this in practice; taking
        // it literally would build callbacks against `/api/...` with no host.
        process.env.BOBBY_CALLBACK_ORIGIN = "   "
        expect(callbackOrigin("https://tracker.example.com")).toBe("https://tracker.example.com")
    })

    test("trailing slashes are trimmed so callers can append a path", () => {
        process.env.BOBBY_CALLBACK_ORIGIN = "https://tunnel.example.dev/"
        expect(`${callbackOrigin("x")}/api/internal/analysis-result`).toBe(
            "https://tunnel.example.dev/api/internal/analysis-result",
        )
    })
})

describe("isLoopbackOrigin", () => {
    test.each([
        ["http://localhost:3000", true],
        ["http://127.0.0.1:3000", true],
        ["http://[::1]:3000", true],
        ["http://app.localhost:3000", true],
        ["https://tracker.example.com", false],
        ["http://192.168.1.134:3000", false], // LAN: reachable from another host
        ["not a url", false],
    ])("%s → %s", (origin, expected) => {
        expect(isLoopbackOrigin(origin as string)).toBe(expected)
    })
})

describe("callbackIsUnreachable", () => {
    test("loopback callback + remote analyser is the broken pairing", () => {
        expect(callbackIsUnreachable("http://localhost:3000/api/x", "https://asia.analyser.example.com")).toBe(true)
    })

    test("both local is fine — the usual all-on-one-machine setup", () => {
        expect(callbackIsUnreachable("http://localhost:3000/api/x", "http://localhost:8080")).toBe(false)
    })

    test("a public callback is fine wherever the analyser is", () => {
        expect(callbackIsUnreachable("https://tracker.example.com/api/x", "https://asia.analyser.example.com")).toBe(false)
    })

    test("a LAN callback is NOT flagged — another host can reach it", () => {
        // The on-device testing setup uses exactly this, so flagging it would
        // break a working configuration.
        expect(callbackIsUnreachable("http://192.168.1.134:3000/api/x", "http://192.168.1.50:8080")).toBe(false)
    })
})
