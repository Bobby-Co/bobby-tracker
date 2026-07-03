// One-shot: re-embed every issue with the CURRENT analyser embedding model.
//
// Run this after switching the analyser's embed provider (now
// qwen3-embedding-8b @ 1536 via Fireworks). You can't mix embedding models in
// one vector space, so all issue vectors produced by the old model
// (text-embedding-3-small) must be regenerated. Migration 0037 clears the old
// rows; this script repopulates them.
//
// It goes through the SAME path new issues use (lib/analyser.ts:embedText →
// the analyser's /embeddings), so it always matches production's model + dims.
//
// Required env (.env.local is auto-loaded by bun):
//   NEXT_PUBLIC_SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
//   BOBBY_ANALYSER_URL            (+ BOBBY_ANALYSER_TOKEN if the analyser is gated)
//
// Run with:
//   bun scripts/reembed-issues.ts
//
// Idempotent — safe to re-run (upserts on issue_id).

import { createClient } from "@supabase/supabase-js"
import { embedText, issueEmbeddingText } from "../lib/analyser"

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ""
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ""
const CONCURRENCY = 8 // keep the analyser's embed endpoint comfortable
const PAGE = 1000

interface IssueRow {
    id: string
    title: string | null
    body: string | null
}

async function main() {
    if (!SUPABASE_URL || !SERVICE_KEY) {
        throw new Error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set")
    }
    const db = createClient(SUPABASE_URL, SERVICE_KEY, {
        db: { schema: "tracker" },
        auth: { persistSession: false },
    })

    // Page through every issue.
    const issues: IssueRow[] = []
    for (let from = 0; ; from += PAGE) {
        const { data, error } = await db
            .from("issues")
            .select("id,title,body")
            .order("created_at", { ascending: true })
            .range(from, from + PAGE - 1)
            .returns<IssueRow[]>()
        if (error) throw error
        if (!data || data.length === 0) break
        issues.push(...data)
        if (data.length < PAGE) break
    }
    console.log(`re-embedding ${issues.length} issues with ${CONCURRENCY}-way concurrency…`)

    let cursor = 0
    let done = 0
    let failed = 0

    async function worker() {
        for (;;) {
            const i = cursor++
            if (i >= issues.length) return
            const is = issues[i]
            try {
                const { vector, model } = await embedText(
                    issueEmbeddingText({ title: is.title ?? "", body: is.body ?? "" }),
                )
                const { error } = await db
                    .from("issue_embeddings")
                    .upsert({ issue_id: is.id, embedding: vector, model }, { onConflict: "issue_id" })
                if (error) throw error
            } catch (e) {
                failed++
                console.error(`  issue ${is.id} failed:`, e instanceof Error ? e.message : e)
            }
            done++
            if (done % 50 === 0 || done === issues.length) {
                console.log(`  ${done}/${issues.length} (${failed} failed)`)
            }
        }
    }

    await Promise.all(Array.from({ length: CONCURRENCY }, worker))
    console.log(`done: ${done - failed} embedded, ${failed} failed`)
    if (failed > 0) process.exitCode = 1
}

main().catch((e) => {
    console.error(e)
    process.exit(1)
})
