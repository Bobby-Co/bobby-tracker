import { test, expect, describe } from "bun:test"
import { importedPullRequestFiles } from "./ImportGraph"

const manifest = [
    { path: "src/notifications/app/webhook-service.ts", status: "added" },
    { path: "src/notifications/infra/outbox-repo.ts", status: "modified" },
    { path: "src/notifications/domain/fanout.ts", status: "added" },
    { path: "src/workers/webhook-worker.ts", status: "added" },
]

describe("importedPullRequestFiles", () => {
    // The live case. The worker imports "../notifications/app/webhook-service.js";
    // the file on disk is .ts, and the reviewer ripgrepped for it, found nothing,
    // and raised a finding about a contract it could not verify.
    test("resolves a .js specifier to the .ts file the pull request adds", () => {
        const push = [{
            path: "src/workers/webhook-worker.ts",
            patch: '@@\n+import { fanout } from "../notifications/app/webhook-service.js"\n',
        }]
        expect(importedPullRequestFiles(push, manifest)).toEqual(["src/notifications/app/webhook-service.ts"])
    })

    test("resolves .. and . the way a bundler would", () => {
        const push = [{
            path: "src/notifications/app/webhook-service.ts",
            patch: '@@\n+import { isDue } from "../domain/fanout.js"\n+import * as repo from "./../infra/outbox-repo.js"\n',
        }]
        expect(importedPullRequestFiles(push, manifest).sort()).toEqual([
            "src/notifications/domain/fanout.ts",
            "src/notifications/infra/outbox-repo.ts",
        ])
    })

    // The push's own files already carry their patches; sending them twice would
    // be pure waste and would misreport how much is under review.
    test("never returns a file that is already in the push", () => {
        const push = [
            { path: "src/workers/webhook-worker.ts", patch: '@@\n+import x from "../notifications/domain/fanout.js"\n' },
            { path: "src/notifications/domain/fanout.ts", patch: "@@\n+export const x = 1\n" },
        ]
        expect(importedPullRequestFiles(push, manifest)).toEqual([])
    })

    // A bare specifier is a package. No manifest will ever contain it.
    test("ignores package imports", () => {
        const push = [{ path: "src/workers/webhook-worker.ts", patch: '@@\n+import express from "express"\n+import { z } from "zod"\n' }]
        expect(importedPullRequestFiles(push, manifest)).toEqual([])
    })

    test("ignores a relative import the pull request does not touch", () => {
        const push = [{ path: "src/workers/webhook-worker.ts", patch: '@@\n+import { info } from "../shared/logger.js"\n' }]
        expect(importedPullRequestFiles(push, manifest)).toEqual([])
    })

    test("catches require and dynamic import too", () => {
        const push = [{
            path: "src/workers/webhook-worker.ts",
            patch: '@@\n+const r = require("../notifications/infra/outbox-repo.js")\n+await import("../notifications/domain/fanout.js")\n',
        }]
        expect(importedPullRequestFiles(push, manifest).sort()).toEqual([
            "src/notifications/domain/fanout.ts",
            "src/notifications/infra/outbox-repo.ts",
        ])
    })

    test("de-duplicates across several importing files", () => {
        const push = [
            { path: "src/workers/webhook-worker.ts", patch: '@@\n+import a from "../notifications/domain/fanout.js"\n' },
            { path: "src/api/routes/webhooks.ts", patch: '@@\n+import b from "../../notifications/domain/fanout.js"\n' },
        ]
        expect(importedPullRequestFiles(push, manifest)).toEqual(["src/notifications/domain/fanout.ts"])
    })

    // A barrel importing forty modules must not turn a one-file review into forty.
    test("is bounded", () => {
        const big = Array.from({ length: 20 }, (_, i) => ({ path: `src/m${i}.ts` }))
        const push = [{
            path: "src/entry.ts",
            patch: "@@\n" + big.map((m) => `+import x from "./m${m.path.match(/m(\d+)/)![1]}.js"`).join("\n"),
        }]
        expect(importedPullRequestFiles(push, big, 3)).toHaveLength(3)
    })

    test("survives a file with no patch", () => {
        expect(importedPullRequestFiles([{ path: "a.ts" }], manifest)).toEqual([])
    })
})
