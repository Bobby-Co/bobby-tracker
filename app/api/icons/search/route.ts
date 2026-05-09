import { jsonError, requireUser } from "@/lib/api"
import { AnalyserError, embedText } from "@/lib/analyser"
import { createServiceClient } from "@/lib/supabase/server"

// POST /api/icons/search — semantic icon lookup.
//
// Body: { q: string, limit?: number }
//
// Pipeline:
//   1. Look up tracker.icon_catalog_meta.version (cached briefly
//      in process). This stamps every cache row + every response;
//      a re-embed run rotates it and old data falls out of scope.
//   2. Normalize the query (trim + lowercase + collapse spaces) and
//      check tracker.icon_search_cache for a row at the current
//      version. Cache hit → return immediately, bump last_used_at +
//      hit_count fire-and-forget.
//   3. Cache miss → embed via the analyser, run find_similar_icons,
//      upsert the hits with the current version, and return.
//
// Auth: requireUser. The catalog is global but the embedding call
// is metered, so we don't expose it to anonymous traffic.
export async function POST(request: Request) {
    const { error } = await requireUser()
    if (error) return error

    let body: Record<string, unknown>
    try {
        body = await request.json()
    } catch {
        return jsonError("bad_request", "invalid JSON", 400)
    }

    const limit = clampLimit(body.limit)
    const svc = createServiceClient()
    const version = await getActiveVersion(svc)

    const q = normalizeQuery(typeof body.q === "string" ? body.q : "")
    if (!q) return Response.json({ icons: [], cached: false, version })

    // ─── Cache lookup (filtered to the current version) ───────────
    const { data: cached, error: cacheReadErr } = await svc
        .from("icon_search_cache")
        .select("hits")
        .eq("query", q)
        .eq("version", version)
        .maybeSingle<{ hits: SemanticHit[] }>()
    if (cacheReadErr) {
        // Don't fail the request — fall through to a fresh embed if
        // the cache read errors.
        console.error("icon_search_cache read failed:", cacheReadErr.message)
    }
    if (cached?.hits) {
        void bumpLru(svc, q)
        return Response.json({
            icons: cached.hits.slice(0, limit),
            cached: true,
            version,
        })
    }

    // ─── Cache miss: embed, rank, store ───────────────────────────
    let vector: number[]
    let model: string
    try {
        const result = await embedText(q)
        vector = result.vector
        model = result.model
    } catch (e) {
        const msg = e instanceof AnalyserError ? e.message : "embed failed"
        return jsonError("embed_failed", msg, 502)
    }

    const { data: ranked, error: dbErr } = await svc.rpc("find_similar_icons", {
        p_embedding: vector as unknown as string,
        p_limit:     200,
    })
    if (dbErr) return jsonError("db_error", dbErr.message, 500)

    const hits = (ranked ?? []) as SemanticHit[]

    void svc
        .from("icon_search_cache")
        .upsert(
            { query: q, hits, model, version },
            { onConflict: "query" },
        )
        .then(({ error }) => {
            if (error) console.error("icon_search_cache write failed:", error.message)
        })

    return Response.json({
        icons: hits.slice(0, limit),
        cached: false,
        version,
    })
}

interface SemanticHit { name: string; similarity: number }

function normalizeQuery(raw: string): string {
    return raw.trim().replace(/\s+/g, " ").toLowerCase()
}

function clampLimit(raw: unknown): number {
    const n = typeof raw === "number" ? raw : Number.parseInt(String(raw ?? ""), 10)
    if (!Number.isFinite(n) || n <= 0) return 60
    return Math.min(Math.max(Math.trunc(n), 1), 200)
}

// Tiny in-process TTL cache for the version row. The embed script
// flips this maybe once a week — we don't need to fetch it on every
// request, but we also don't want to wait minutes after a re-embed
// for clients to see the new value. 30s is the right ballpark.
const VERSION_TTL_MS = 30_000
let versionCache: { value: string; expiresAt: number } | null = null

async function getActiveVersion(
    svc: ReturnType<typeof createServiceClient>,
): Promise<string> {
    const now = Date.now()
    if (versionCache && now < versionCache.expiresAt) {
        return versionCache.value
    }
    const { data } = await svc
        .from("icon_catalog_meta")
        .select("version")
        .eq("id", 1)
        .maybeSingle<{ version: string }>()
    // Fall back to a sentinel if the meta row is somehow missing —
    // it was inserted by the migration so this shouldn't happen.
    const value = data?.version ?? "unknown"
    versionCache = { value, expiresAt: now + VERSION_TTL_MS }
    return value
}

async function bumpLru(
    svc: ReturnType<typeof createServiceClient>,
    query: string,
): Promise<void> {
    const { data, error } = await svc
        .from("icon_search_cache")
        .select("hit_count")
        .eq("query", query)
        .maybeSingle<{ hit_count: number }>()
    if (error || !data) return
    await svc
        .from("icon_search_cache")
        .update({
            last_used_at: new Date().toISOString(),
            hit_count: data.hit_count + 1,
        })
        .eq("query", query)
}
