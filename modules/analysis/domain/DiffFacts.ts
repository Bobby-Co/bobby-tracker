// The deterministic diff pre-scan, tracker side.
//
// Incremental review needs one question answered before it may carry a finding
// forward untouched: DID THIS PUSH CHANGE ANY EXPORTED SYMBOL THE FINDING TALKS
// ABOUT? The file test alone is not enough, because blast radius is global —
// deleting a caller in file X can resolve a finding in untouched file Y, and
// carrying that finding forward would report a defect that no longer exists.
//
// PURE, and deliberately NOT a question for the analyser. It is a text scan over
// patches we already hold; routing it through the graph would add a network hop,
// a failure mode and a model to a decision that is arithmetic. The analyser's
// own factscan does the same scan for a different purpose (demanding a
// caller-impact list); this is the tracker's half, and the two are allowed to
// disagree because they gate different things.

/** The minimum a scan needs from a changed file. Structurally satisfied by
 *  PrAnalyseFile and by the vcs VcsPullRequestFile (after mapping), so callers
 *  pass what they already have. */
export interface ScannableFile {
    path: string
    previous_path?: string
    status?: string
    patch?: string
}

type Lang = "go" | "python" | "typescript" | ""

/** A definition line, across Go/Python/TS/JS, capturing the name. Best-effort by
 *  design: it only has to catch the common shapes, and a shape it misses costs a
 *  carried finding that could have been re-judged — see the note on direction in
 *  changedExportedSymbols. */
const DEF_RE: RegExp[] = [
    // Go: func Name( , func (r R) Name( , type Name
    /^func\s+(?:\([^)]*\)\s+)?([A-Za-z_]\w*)\s*[([]/,
    /^type\s+([A-Za-z_]\w*)\b/,
    // Python: def name( , async def name( , class Name
    /^(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(/,
    /^class\s+([A-Za-z_$][\w$]*)\b/,
    // TS/JS: export function name / function name( / class Name / const name = (…) =>
    /^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*[(<]/,
    /^(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)\b/,
    /^(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:async\s+)?[(<]/,
    // TS type-level exports, which are as load-bearing here as functions: a
    // renamed field on an exported interface reaches every file that reads it.
    /^(?:export\s+)?(?:declare\s+)?(?:interface|type|enum)\s+([A-Za-z_$][\w$]*)\b/,
]

function langOf(path: string): Lang {
    if (path.endsWith(".go")) return "go"
    if (path.endsWith(".py")) return "python"
    if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(path)) return "typescript"
    return ""
}

/** A defined identifier on one patch line (leading +/- already stripped), or "". */
function defName(line: string): string {
    const s = line.trim()
    for (const re of DEF_RE) {
        const m = re.exec(s)
        if (m) return m[1]
    }
    return ""
}

/** Public in its own language: Go by capital, Python by no leading underscore,
 *  TS/JS by the `export` keyword actually being on the line (falling back to the
 *  underscore convention for a class member). */
function exported(name: string, lang: Lang, line: string): boolean {
    if (name === "") return false
    if (lang === "go") return name[0] >= "A" && name[0] <= "Z"
    if (lang === "typescript" || lang === "") {
        if (/\bexport\b/.test(line)) return true
    }
    return !name.startsWith("_")
}

/** Every exported symbol name this diff DEFINES DIFFERENTLY — removed, renamed,
 *  signature-changed, or newly added.
 *
 *  This is broader than the analyser's `factscan.changedExported()`, which
 *  reports only removed/renamed/signature-changed definitions. That scan exists
 *  to demand a caller-impact list, so a brand-new export is genuinely not its
 *  business. This one exists to decide when a finding may ride along
 *  UNEXAMINED, which is the opposite job: a new export in a shared module is
 *  exactly the sort of change that can invalidate a finding in a file the diff
 *  never mentions.
 *
 *  The error direction is the one the design chose everywhere else — a name that
 *  should not have been listed costs a re-judgement, a name that should have been
 *  costs a defect carried forward as live when it is stale, and only one of those
 *  reaches the merge gate.
 *
 *  Sorted and de-duplicated, so two runs over the same diff produce the same
 *  list and a stored scope decision is comparable with a recomputed one. */
export function changedExportedSymbols(files: ScannableFile[]): string[] {
    const names = new Set<string>()

    for (const f of files) {
        const lang = langOf(f.path)
        // A rename carries every symbol in the file with it, and the pre-image
        // path is what the old finding would have cited.
        const renamed = f.status === "renamed"

        for (const raw of (f.patch ?? "").split("\n")) {
            if (raw.startsWith("@@") || raw.startsWith("+++") || raw.startsWith("---")) continue
            if (raw.length === 0) continue
            const sign = raw[0]
            if (sign !== "+" && sign !== "-") continue
            const body = raw.slice(1)
            const name = defName(body)
            if (name === "") continue
            if (!exported(name, lang, body)) continue
            names.add(name)
        }

        // A whole-file removal or rename changes every symbol it defined, and the
        // patch of a deleted file is all "-" lines, so the loop above already
        // caught them. This stays as a marker of the intent for the reader — and
        // for the case a provider ships a rename with an EMPTY patch, where the
        // path change is the only evidence there is.
        if (renamed && !(f.patch ?? "").trim() && f.previous_path) {
            const stem = f.previous_path.split("/").pop()?.replace(/\.\w+$/, "") ?? ""
            if (stem) names.add(stem)
        }
    }

    return [...names].sort()
}

/** Does a changed symbol name appear in this text?
 *
 *  A word-boundary match, case-SENSITIVE, because identifiers are: matching
 *  `Get` against "get the user" would re-judge on prose rather than on code.
 *  Boundaries are the identifier's own characters, so `findUser` does not match
 *  inside `findUserById` — a different symbol with a longer name is a different
 *  symbol. */
export function mentionsSymbol(text: string, symbol: string): boolean {
    if (!symbol) return false
    const escaped = symbol.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    return new RegExp(`(^|[^A-Za-z0-9_$])${escaped}([^A-Za-z0-9_$]|$)`).test(text)
}

/** The first changed symbol this text mentions, or null. Returning WHICH one
 *  rather than a boolean is what lets the round say why a finding was re-judged
 *  instead of only that it was. */
export function mentionedSymbol(text: string, symbols: string[]): string | null {
    for (const s of symbols) if (mentionsSymbol(text, s)) return s
    return null
}

/** Does this diff touch a schema migration?
 *
 *  A migration reaches code the diff never mentions — the `tasks.tenant_id`
 *  rename broke `tasks-repo.ts` without appearing in it — so its presence forces
 *  a full review. Deliberately generous: the cost of being wrong is one full
 *  review, and the cost of missing one is a review that cannot see the thing it
 *  needed to. */
export function touchesMigration(files: ScannableFile[]): boolean {
    return files.some((f) => {
        const p = f.path.toLowerCase()
        if (p.endsWith(".sql")) return true
        if (/(^|\/)migrations?\//.test(p)) return true
        if (/(^|\/)alembic\//.test(p)) return true
        if (p.endsWith("schema.prisma")) return true
        if (/(^|\/)db\/schema\.rb$/.test(p)) return true
        return false
    })
}
