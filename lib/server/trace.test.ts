import { afterEach, describe, expect, test } from "bun:test"
import { dbRef, trace } from "./trace"

const ORIGINAL = process.env.BOBBY_TRACE

function captureLogs(run: () => void): string[] {
    const lines: string[] = []
    const real = console.log
    console.log = (...args: unknown[]) => lines.push(args.map(String).join(" "))
    try {
        run()
    } finally {
        console.log = real
    }
    return lines
}

afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.BOBBY_TRACE
    else process.env.BOBBY_TRACE = ORIGINAL
})

describe("trace gating", () => {
    // The property worth pinning: this is loud enough that leaving it on is a
    // real cost, so silence must be what you get by DEFAULT rather than what you
    // remember to ask for.
    test("silent when BOBBY_TRACE is unset", () => {
        delete process.env.BOBBY_TRACE
        expect(captureLogs(() => trace("ctx.bindCell", { cell: "bangkok-0" }))).toEqual([])
    })

    test.each(["0", "false", "FALSE", ""])("silent when BOBBY_TRACE=%p", (v) => {
        process.env.BOBBY_TRACE = v
        expect(captureLogs(() => trace("ctx.bindCell", {}))).toEqual([])
    })

    test("emits one tagged JSON line when enabled", () => {
        process.env.BOBBY_TRACE = "1"
        const lines = captureLogs(() => trace("apply.dropped", { taskId: "t1" }))
        expect(lines).toHaveLength(1)
        expect(JSON.parse(lines[0])).toEqual({ tag: "bobby.trace", event: "apply.dropped", taskId: "t1" })
    })

    test("a circular field degrades to a note instead of throwing into the request", () => {
        process.env.BOBBY_TRACE = "1"
        const circular: Record<string, unknown> = {}
        circular.self = circular
        const lines = captureLogs(() => trace("probe.error", circular))
        expect(JSON.parse(lines[0]).note).toBe("fields unserialisable")
    })
})

describe("dbRef", () => {
    // Identifies WHICH database without ever carrying a credential.
    test("reduces a Supabase URL to its project ref", () => {
        expect(dbRef("https://kayshdvbxnmywgflqhgh.supabase.co")).toBe("kayshdvbxnmywgflqhgh")
    })

    test.each([
        [undefined, "none"],
        [null, "none"],
        ["", "none"],
        ["not a url", "unparseable"],
    ])("%p → %p", (input, expected) => {
        expect(dbRef(input as string | undefined)).toBe(expected)
    })
})
