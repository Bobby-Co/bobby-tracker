// Auto-label every icon with gpt-4.1-nano.
//
// For each icon file, send the kebab slug + the SVG markup to the
// model and ask for { description, tags }. Writes results
// incrementally to lib/iconly-tags.json so a network blip in the
// middle of the run doesn't lose work — the next invocation skips
// any slug already present in the file.
//
// Why this script exists:
//   The build catalog only knows the kebab slug ("rain-drop"). That
//   gives the embedder one or two words. Better tagging
//   ("raindrop, water, weather, precipitation, storm, liquid") lets
//   the cosine similarity actually do its job — a search for
//   "weather" lands on raindrop, sun, cloud etc. instead of nothing.
//
// Required env (.env.local is auto-loaded by bun):
//   OPENAI_API_KEY
//
// Run with:
//   bun scripts/label-icons.ts
//
// Optional flags:
//   --force            Re-label every icon, overwriting the JSON file.
//   --concurrency N    Defaults to 8. Cap at ~16 to stay under the
//                      OpenAI tier-1 RPM ceiling.

import { readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs"
import { join } from "node:path"

const ICONS_DIR = join(__dirname, "..", "icons")
const OUT_FILE = join(__dirname, "..", "lib", "iconly-tags.json")
const MODEL = "gpt-4.1-nano"

const OPENAI_API_KEY = process.env.OPENAI_API_KEY ?? ""

export interface TagEntry {
    /** lowercase keyword or short phrase */
    name: string
    /** 0-1 — how strongly this tag describes the icon */
    confidence: number
}

interface IconLabel {
    description: string
    tags: TagEntry[]
}

type LabelMap = Record<string, IconLabel>

function parseArgs(): { force: boolean; concurrency: number } {
    const args = process.argv.slice(2)
    const force = args.includes("--force")
    const cIdx = args.indexOf("--concurrency")
    const concurrency = cIdx >= 0 ? Math.max(1, parseInt(args[cIdx + 1] ?? "8", 10)) : 8
    return { force, concurrency }
}

function slugFromFile(file: string): string | null {
    const m = file.match(/^Iconly-(.+)-icon\.tsx$/)
    return m ? m[1] : null
}

// Pull the JSX <svg>…</svg> block from the component source. The
// model gets the raw block including {color}/{size} placeholders —
// the path d="…" attributes are what carry the shape.
function extractSvg(src: string): string {
    const start = src.indexOf("<svg")
    const end = src.lastIndexOf("</svg>")
    if (start < 0 || end < 0) return ""
    return src.slice(start, end + "</svg>".length)
}

interface ChatResponse {
    choices: { message: { content: string } }[]
}

async function labelOne(slug: string, svg: string): Promise<IconLabel> {
    const userMsg = [
        `Icon slug: ${slug}`,
        ``,
        `SVG markup:`,
        svg,
        ``,
        `This icon set is used inside a software issue tracker, so a user`,
        `creating a label like "auth", "performance", or "design" should`,
        `find this icon if it's a plausible fit. Tag accordingly.`,
        ``,
        `Return JSON with:`,
        `  - description: one short sentence (<=15 words) describing the icon.`,
        `  - tags: 10-16 entries. EACH entry is an OBJECT with two fields:`,
        `      name:       a lowercase single word or short phrase (never a`,
        `                  comma-separated list).`,
        `      confidence: a number in [0, 1] saying how strongly this tag`,
        `                  describes the icon. Use the full range honestly:`,
        `                    1.00 — literal subject (apple icon → "apple")`,
        `                    0.85-0.95 — direct category / definite synonym`,
        `                                (apple → "fruit", "food")`,
        `                    0.55-0.80 — strong association, common usage`,
        `                                (key icon → "auth", "security")`,
        `                    0.25-0.50 — plausible but loose connection`,
        `                                (apple → "design", "branding")`,
        `                  Drop anything you'd rate below 0.20.`,
        ``,
        `    Mix BOTH kinds of tags:`,
        ``,
        `    (a) Literal subject + categories — usually high confidence.`,
        `        For an apple: { "apple", 1.0 }, { "fruit", 0.95 },`,
        `        { "food", 0.85 }, { "produce", 0.7 }.`,
        ``,
        `    (b) Software-issue context tags — tracker labels the icon could`,
        `        illustrate. These are usually mid-to-low confidence unless`,
        `        the icon is purpose-built (a bug glyph really is "bug" at 1.0`,
        `        but only "ci" at ~0.4). Examples to draw from: bug, feature,`,
        `        refactor, performance, perf, security, auth, login, ui, ux,`,
        `        design, frontend, backend, api, database, infra, devops, ci,`,
        `        deploy, release, docs, analytics, metrics, billing, payments,`,
        `        notifications, onboarding, marketing, branding, content,`,
        `        mobile, accessibility, search, settings, integration, test,`,
        `        qa. Pick the 3-6 most fitting context tags.`,
        ``,
        `    Avoid generic words like "icon", "vector", "image", "graphic".`,
    ].join("\n")

    const res = await fetchWithRetry()
    const json = (await res.json()) as ChatResponse

    async function fetchWithRetry(): Promise<Response> {
        // 429 handling. The TPM bucket refills once per minute, so
        // the API's "try again in 150ms" hint is usually optimistic
        // when we've drained it dry. Back off in seconds, capped at
        // 60s, with a few attempts before giving up on this slug
        // (the next labeller run will pick it up anyway).
        for (let attempt = 0; ; attempt++) {
            const r = await fetch("https://api.openai.com/v1/chat/completions", {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${OPENAI_API_KEY}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    model: MODEL,
                    response_format: { type: "json_object" },
                    temperature: 0,
                    messages: [
                        {
                            role: "system",
                            content:
                                "You label SVG icons for the search index of a software issue tracker. " +
                                "The slug is your primary signal; the SVG markup is supporting evidence. " +
                                "Tags must cover both what the icon literally depicts AND the issue-tracker " +
                                "labels (auth, bug, performance, design, etc.) it could plausibly illustrate. " +
                                "Output strict JSON.",
                        },
                        { role: "user", content: userMsg },
                    ],
                }),
            })
            if (r.ok) return r
            const transient = r.status === 429 || r.status >= 500
            if (!transient || attempt >= 5) {
                const text = await r.text().catch(() => "")
                throw new Error(`OpenAI ${r.status}: ${text || r.statusText}`)
            }
            // 5s, 10s, 20s, 40s, 60s
            const waitMs = Math.min(60_000, 5_000 * 2 ** attempt)
            await new Promise((r) => setTimeout(r, waitMs))
        }
    }
    const content = json.choices?.[0]?.message?.content ?? "{}"
    const parsed = JSON.parse(content) as Partial<IconLabel>
    const description = typeof parsed.description === "string" ? parsed.description.trim() : ""
    const tagsRaw = Array.isArray(parsed.tags) ? parsed.tags : []
    const tags = normaliseTags(tagsRaw)
    if (!description || tags.length === 0) {
        throw new Error(`bad model response for ${slug}: ${content}`)
    }
    return { description, tags }
}

// Accept either the new {name, confidence} object form or the
// legacy plain-string form (still found in lib/iconly-tags.json
// from earlier runs). Comma-joined strings get flattened; missing
// confidences default to 0.6 (a "plausible association" baseline).
function normaliseTags(raw: unknown[]): TagEntry[] {
    const out: TagEntry[] = []
    const seen = new Set<string>()
    for (const item of raw) {
        if (typeof item === "string") {
            for (const piece of item.split(",")) {
                const name = piece.trim().toLowerCase()
                if (!name || name.length >= 40 || seen.has(name)) continue
                seen.add(name)
                out.push({ name, confidence: 0.6 })
            }
            continue
        }
        if (item && typeof item === "object") {
            const obj = item as Record<string, unknown>
            const rawName = typeof obj.name === "string" ? obj.name : ""
            const rawConf = typeof obj.confidence === "number" ? obj.confidence : NaN
            for (const piece of rawName.split(",")) {
                const name = piece.trim().toLowerCase()
                if (!name || name.length >= 40 || seen.has(name)) continue
                seen.add(name)
                const confidence = Number.isFinite(rawConf)
                    ? Math.max(0, Math.min(1, rawConf))
                    : 0.6
                out.push({ name, confidence })
            }
        }
    }
    return out
}

function readExisting(): LabelMap {
    if (!existsSync(OUT_FILE)) return {}
    try {
        return JSON.parse(readFileSync(OUT_FILE, "utf8")) as LabelMap
    } catch {
        return {}
    }
}

function writeOut(map: LabelMap) {
    // Sort keys for stable diffs.
    const sorted: LabelMap = {}
    for (const k of Object.keys(map).sort()) sorted[k] = map[k]
    writeFileSync(OUT_FILE, JSON.stringify(sorted, null, 2) + "\n")
}

async function main() {
    if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not set")
    const { force, concurrency } = parseArgs()

    const files = readdirSync(ICONS_DIR)
        .filter((f) => f.endsWith(".tsx") && f.startsWith("Iconly-"))
        .sort()

    const existing = force ? {} : readExisting()
    const todo: { slug: string; svg: string }[] = []
    for (const file of files) {
        const slug = slugFromFile(file)
        if (!slug) continue
        if (existing[slug]) continue
        const src = readFileSync(join(ICONS_DIR, file), "utf8")
        const svg = extractSvg(src)
        if (!svg) {
            console.warn(`skip ${slug}: no <svg> block`)
            continue
        }
        todo.push({ slug, svg })
    }

    console.log(
        `labeling ${todo.length} icons with ${MODEL} (${Object.keys(existing).length} cached, concurrency ${concurrency})…`,
    )

    // Persist after every N completions so a crash mid-run leaves
    // most of the work usable.
    const PERSIST_EVERY = 10
    let done = 0
    let sinceLastWrite = 0
    const inFlight = new Set<Promise<void>>()

    async function runOne(slug: string, svg: string) {
        try {
            existing[slug] = await labelOne(slug, svg)
        } catch (err) {
            console.error(`  fail ${slug}: ${(err as Error).message}`)
            return
        }
        done++
        sinceLastWrite++
        if (sinceLastWrite >= PERSIST_EVERY) {
            writeOut(existing)
            sinceLastWrite = 0
            console.log(`  ${done}/${todo.length} (saved)`)
        }
    }

    for (const item of todo) {
        const p = runOne(item.slug, item.svg).finally(() => inFlight.delete(p))
        inFlight.add(p)
        if (inFlight.size >= concurrency) {
            await Promise.race(inFlight)
        }
    }
    await Promise.all(inFlight)
    writeOut(existing)
    console.log(`done — ${done} labelled, total ${Object.keys(existing).length}`)
}

main().catch((err) => {
    console.error(err)
    process.exit(1)
})
