// One-shot icon-catalog embed script.
//
// For each icon in ICONLY_CATALOG, builds an embedding text that
// stitches together: the slug, the LLM-generated description (from
// scripts/label-icons.ts → lib/iconly-tags.json), and the LLM tag
// list. Falls back to the slug-derived tags when no LLM labels exist
// yet so the script still produces a usable index without the
// labeling step.
//
// Calls OpenAI text-embedding-3-small in batches and upserts into
// tracker.icon_catalog with the service-role key. Idempotent — safe
// to re-run after adding icons or re-labeling.
//
// Required env (.env.local is auto-loaded by bun):
//   OPENAI_API_KEY
//   NEXT_PUBLIC_SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
//
// Run with:
//   bun scripts/embed-icons.ts

import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { createClient as createSupabaseClient } from "@supabase/supabase-js"
import { ICONLY_CATALOG, type IconlyTag } from "../lib/iconly-catalog"

const TAGS_FILE = join(__dirname, "..", "lib", "iconly-tags.json")

interface RawLabelEntry {
    description: string
    tags?: unknown
}

interface NormalisedLabel {
    description: string
    tags: IconlyTag[]
}

function loadLabels(): Record<string, NormalisedLabel> {
    if (!existsSync(TAGS_FILE)) return {}
    let parsed: Record<string, RawLabelEntry>
    try {
        parsed = JSON.parse(readFileSync(TAGS_FILE, "utf8")) as Record<string, RawLabelEntry>
    } catch {
        return {}
    }
    const out: Record<string, NormalisedLabel> = {}
    for (const [slug, entry] of Object.entries(parsed)) {
        const tags = normaliseTags(entry?.tags)
        const description = typeof entry?.description === "string" ? entry.description : ""
        if (description) out[slug] = { description, tags }
    }
    return out
}

// Accept either {name, confidence}[] (current schema) or string[]
// (older runs) — flatten comma-joined strings, dedupe, clamp.
function normaliseTags(raw: unknown): IconlyTag[] {
    if (!Array.isArray(raw)) return []
    const out: IconlyTag[] = []
    const seen = new Set<string>()
    for (const item of raw) {
        if (typeof item === "string") {
            for (const piece of item.split(",")) {
                const name = piece.trim().toLowerCase()
                if (!name || seen.has(name)) continue
                seen.add(name)
                out.push({ name, confidence: 0.8 })
            }
            continue
        }
        if (item && typeof item === "object") {
            const obj = item as Record<string, unknown>
            const rawName = typeof obj.name === "string" ? obj.name : ""
            const rawConf = typeof obj.confidence === "number" ? obj.confidence : 0.6
            for (const piece of rawName.split(",")) {
                const name = piece.trim().toLowerCase()
                if (!name || seen.has(name)) continue
                seen.add(name)
                out.push({ name, confidence: Math.max(0, Math.min(1, rawConf)) })
            }
        }
    }
    return out
}

const OPENAI_API_KEY = process.env.OPENAI_API_KEY ?? ""
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ""
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ""

const EMBED_MODEL = "text-embedding-3-small"
// Stay well under the 2048-input batch cap; 100 keeps each request
// snappy and the failure blast-radius small.
const BATCH_SIZE = 100

interface OpenAIEmbedResponse {
    data: { embedding: number[]; index: number }[]
    model: string
    usage: { prompt_tokens: number; total_tokens: number }
}

// Repeating a tag in the embedding text boosts its contribution to
// the resulting vector. We map confidence → repeat count: a 1.0
// tag shows up ~MAX_REPEAT times, a 0.2 tag once, anything weaker
// drops out entirely. This is what stops "design" / "marketing"
// (low-confidence software-context tags on a fruit icon) from
// flooding the search results when somebody types those queries.
const MAX_REPEAT = 4
const MIN_CONFIDENCE = 0.2

function repeatCount(confidence: number): number {
    if (confidence < MIN_CONFIDENCE) return 0
    return Math.max(1, Math.round(confidence * MAX_REPEAT))
}

function embeddingText(
    name: string,
    baseTags: IconlyTag[],
    label: NormalisedLabel | undefined,
): string {
    const human = name.replace(/-/g, " ")
    const description = label?.description ?? ""
    const sourceTags = label?.tags?.length ? label.tags : baseTags

    // Strong keywords (>= 0.7) lead the keyword line so the embedder
    // anchors them first; remaining ones still appear (with weaker
    // representation) so synonym queries can reach the icon.
    const expanded: string[] = []
    const sorted = [...sourceTags].sort((a, b) => b.confidence - a.confidence)
    for (const t of sorted) {
        const n = repeatCount(t.confidence)
        for (let i = 0; i < n; i++) expanded.push(t.name)
    }
    const keywords = expanded.join(", ")

    const parts = [`icon: ${human}.`]
    if (description) parts.push(description)
    if (keywords) parts.push(`keywords: ${keywords}`)
    return parts.join(" ")
}

async function embedBatch(inputs: string[]): Promise<number[][]> {
    const res = await fetch("https://api.openai.com/v1/embeddings", {
        method: "POST",
        headers: {
            Authorization: `Bearer ${OPENAI_API_KEY}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({ model: EMBED_MODEL, input: inputs }),
    })
    if (!res.ok) {
        const text = await res.text().catch(() => "")
        throw new Error(`OpenAI embeddings ${res.status}: ${text || res.statusText}`)
    }
    const json = (await res.json()) as OpenAIEmbedResponse
    // Sort by `index` so ordering matches `inputs` 1:1.
    return json.data
        .slice()
        .sort((a, b) => a.index - b.index)
        .map((d) => d.embedding)
}

async function main() {
    if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not set")
    if (!SUPABASE_URL) throw new Error("NEXT_PUBLIC_SUPABASE_URL is not set")
    if (!SERVICE_KEY) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set")

    const supabase = createSupabaseClient(SUPABASE_URL, SERVICE_KEY, {
        db: { schema: "tracker" },
        auth: { persistSession: false },
    })

    const labels = loadLabels()
    const labelled = Object.keys(labels).length
    const total = ICONLY_CATALOG.length
    console.log(
        `embedding ${total} icons with ${EMBED_MODEL} (${labelled}/${total} have LLM tags) in batches of ${BATCH_SIZE}…`,
    )

    let done = 0
    for (let start = 0; start < total; start += BATCH_SIZE) {
        const slice = ICONLY_CATALOG.slice(start, start + BATCH_SIZE)
        const inputs = slice.map((icon) => embeddingText(icon.name, icon.tags, labels[icon.name]))

        const vectors = await embedBatch(inputs)
        if (vectors.length !== slice.length) {
            throw new Error(`embed batch returned ${vectors.length} vectors for ${slice.length} inputs`)
        }

        const rows = slice.map((icon, i) => {
            const label = labels[icon.name]
            const tags = label?.tags?.length ? label.tags : icon.tags
            // DB column is text[] — store just the names. The
            // confidence-weighted view lives in the embedding text.
            const tagNames = tags.map((t) => t.name)
            return {
                name:        icon.name,
                tags:        tagNames,
                description: label?.description ?? null,
                embedding:   vectors[i] as unknown as string, // pgvector accepts JSON array
                model:       EMBED_MODEL,
                updated_at:  new Date().toISOString(),
            }
        })

        const { error } = await supabase
            .from("icon_catalog")
            .upsert(rows, { onConflict: "name" })
        if (error) throw new Error(`supabase upsert failed: ${error.message}`)

        done += slice.length
        console.log(`  upserted ${done}/${total}`)
    }

    // Bump the catalog version so /api/icons/search starts handing
    // out fresh rankings and clients invalidate their in-memory
    // caches. Old rows in icon_search_cache stay around but are
    // ignored by the route's version filter — they'll get
    // overwritten the next time someone searches for that query.
    const newVersion = crypto.randomUUID()
    const { error: versionErr } = await supabase
        .from("icon_catalog_meta")
        .update({ version: newVersion, updated_at: new Date().toISOString() })
        .eq("id", 1)
    if (versionErr) {
        throw new Error(`version bump failed: ${versionErr.message}`)
    }
    console.log(`done — catalog version is now ${newVersion}`)
}

main().catch((err) => {
    console.error(err)
    process.exit(1)
})
