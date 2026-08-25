// Which of the pull request's files does this push's diff IMPORT?
//
// ─── Why this exists ────────────────────────────────────────────────────────
//
// The reviewer's checkout is the last-indexed default branch, so a file this
// pull request CREATES has never been in it. Sending the push's files with their
// whole-pull-request patches fixed that for the files under review. It does not
// fix their dependencies.
//
// Four rounds on one merge request, getting worse each time:
//
//   round 4  "the three changed modules do not exist in the checkout" — zero
//            findings, an impact section describing the pre-PR codebase
//   round 5  "this API ships with no routes or worker wired to it" — about an
//            API with both
//   round 7  "confirm that file ships in the same PR" — hedged, after the
//            manifest landed
//   round 8  an actual FINDING: "fanout return contract unverifiable … ripgrep
//            finds no 'fanout' in the tree"
//
// The manifest helped and was not enough, and round 8 shows why: the reviewer
// ran ripgrep, got zero matches, and trusted that over a line in its prompt. A
// tool result is concrete and an instruction is not. Telling it harder is not
// the fix; the file has to be there.
//
// So a push's file brings the pull request's own files that it imports, as
// CONTEXT rather than as work. Bounded by the imports actually present in the
// diff, which on a one-file push is one or two files.
//
// PURE — a text scan over patches and paths, no I/O, no model.

/** A file the pull request touches, as the manifest knows it. */
export interface ManifestFile {
    path: string
    status?: string
    patch?: string
}

/** The minimum needed to scan a pushed file for its imports. */
export interface ImportingFile {
    path: string
    patch?: string
}

/** Import specifiers, across the shapes a diff actually contains. Deliberately
 *  loose: a specifier this misses costs the reviewer a file it already lacked,
 *  and one it over-matches costs a path lookup that finds nothing. */
const SPECIFIER_RE = [
    /\bfrom\s+["']([^"']+)["']/g,
    /\bimport\s+["']([^"']+)["']/g,
    /\brequire\(\s*["']([^"']+)["']\s*\)/g,
    /\bimport\(\s*["']([^"']+)["']\s*\)/g,
]

/** Extensions to try when a specifier does not name a real file. `.js → .ts` is
 *  first because it is the case that bit us: TypeScript ESM writes the emitted
 *  extension in the specifier, so `./fanout.js` on disk is `fanout.ts`. */
const CANDIDATE_SUFFIXES = ["", ".ts", ".tsx", ".js", ".jsx", ".mjs", "/index.ts", "/index.js"]

/** Resolve `./x.js` against the directory of the file that imported it. */
function resolveRelative(fromPath: string, specifier: string): string {
    const dir = fromPath.split("/").slice(0, -1)
    const parts = specifier.split("/")
    const out = [...dir]
    for (const p of parts) {
        if (p === "." || p === "") continue
        if (p === "..") out.pop()
        else out.push(p)
    }
    return out.join("/")
}

/** Every specifier the patch mentions. Both sides of the diff: an import on a
 *  removed line still tells us what the file depends on in the version the
 *  reviewer is being shown, and context lines carry them too. */
function specifiersIn(patch: string): string[] {
    const out = new Set<string>()
    for (const re of SPECIFIER_RE) {
        re.lastIndex = 0
        let m: RegExpExecArray | null
        while ((m = re.exec(patch)) !== null) {
            const spec = m[1]
            // Only RELATIVE imports can name a file in this repository. A bare
            // specifier is a package, and no amount of manifest will contain it.
            if (spec.startsWith("./") || spec.startsWith("../")) out.add(spec)
        }
    }
    return [...out]
}

/** The pull request's files that this push's diff imports, with their content.
 *
 *  Excludes anything already in the push — those are being reviewed and already
 *  carry their patches. Returns manifest entries so the caller can attach the
 *  patch to the manifest it is already sending, rather than inventing a second
 *  channel for the same thing.
 *
 *  `limit` bounds the worst case: a barrel file importing forty modules should
 *  not turn a one-file review into a forty-file one. When it bites, the reviewer
 *  is no worse off than before this existed for the files that got cut. */
export function importedPullRequestFiles(
    pushFiles: ImportingFile[],
    manifest: ManifestFile[],
    limit = 6,
): string[] {
    const inPush = new Set(pushFiles.map((f) => f.path.toLowerCase()))
    const known = new Map(manifest.map((m) => [m.path.toLowerCase(), m.path]))
    const found: string[] = []

    for (const f of pushFiles) {
        for (const spec of specifiersIn(f.patch ?? "")) {
            const base = resolveRelative(f.path, spec)
            // Strip the specifier's own extension before trying candidates, so
            // `./fanout.js` reaches `fanout.ts` rather than only `fanout.js.ts`.
            const stem = base.replace(/\.(ts|tsx|js|jsx|mjs|cjs)$/, "")
            for (const suffix of CANDIDATE_SUFFIXES) {
                for (const candidate of [base + suffix, stem + suffix]) {
                    const hit = known.get(candidate.toLowerCase())
                    if (!hit) continue
                    if (inPush.has(hit.toLowerCase())) continue
                    if (found.includes(hit)) continue
                    found.push(hit)
                    break
                }
                if (found.length >= limit) return found
            }
        }
    }
    return found
}

/** The pull request's files that IMPORT this push's files — the other direction.
 *
 *  ─── Why both directions ────────────────────────────────────────────────────
 *
 *  `importedPullRequestFiles` answers "what does this push depend on". It does
 *  not answer "who, in this pull request, depends on the push" — and that is the
 *  question the reviewer asks unprompted, every round, under the name blast
 *  radius. When the answer is a file the pull request modified in an EARLIER
 *  push, the reviewer reads it from the checkout, sees the pre-pull-request
 *  version, and concludes the push's work is unreachable.
 *
 *  MR !6 round 11, verbatim:
 *
 *    "plansRouter is never mounted — the new endpoints are unreachable …
 *     ripgrep for 'plansRouter' finds nothing outside plans.ts"
 *
 *  It was mounted, at server.ts:9 and :26, by the previous push. server.ts was
 *  in the manifest as a bare path, so the reviewer knew the file existed and
 *  read the only copy it had: main's. Same shape as the fanout case that
 *  motivated the outbound scan — a tool result beat an instruction, and the file
 *  has to actually be there.
 *
 *  Scanning is cheap because the caller already holds every patch: the whole
 *  pull request was fetched to build the cumulative patches.
 *
 *  PURE — a text scan over patches and paths, no I/O, no model. */
export function importersOfPullRequestFiles(
    pushFiles: ImportingFile[],
    manifest: ManifestFile[],
    limit = 6,
): string[] {
    const inPush = new Set(pushFiles.map((f) => f.path.toLowerCase()))
    const found: string[] = []

    for (const m of manifest) {
        if (inPush.has(m.path.toLowerCase())) continue
        if (!m.patch) continue
        for (const spec of specifiersIn(m.patch)) {
            const base = resolveRelative(m.path, spec)
            const stem = base.replace(/\.(ts|tsx|js|jsx|mjs|cjs)$/, "")
            let hit = false
            for (const suffix of CANDIDATE_SUFFIXES) {
                for (const candidate of [base + suffix, stem + suffix]) {
                    if (inPush.has(candidate.toLowerCase())) {
                        hit = true
                        break
                    }
                }
                if (hit) break
            }
            if (hit && !found.includes(m.path)) {
                found.push(m.path)
                break
            }
        }
        if (found.length >= limit) return found
    }
    return found
}
