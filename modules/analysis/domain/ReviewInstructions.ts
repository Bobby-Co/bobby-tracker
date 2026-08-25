// Sanitisation for the one part of a review profile a human writes freehand.
//
// Everything else in a profile is a choice from a closed set, which is safe by
// construction. This is the part that isn't: arbitrary text, written by a team
// admin, that ends up inside a prompt sent to a model that will then read a
// codebase and decide what blocks a merge.
//
// ─── What this is, and is not, defending against ────────────────────────────
//
// It is NOT the security boundary. The boundary is analyser-side and structural:
// the text never joins the system prompt, it goes in a fenced block under a
// constitution that says it is data, any attempt to close that fence from inside
// is defanged, and behind all of it the deterministic gate still drops
// ungrounded findings and derives the verdict itself. Nothing typed here can
// produce an approval that the findings don't support.
//
// What this IS defending against is the stuff that makes containment fragile:
// text long enough to bury the rules, invisible characters that read differently
// to a model than to the admin who approved them, and control characters that
// break the block structure. Getting those out at the point of WRITING means the
// stored value is the same thing the author saw.
//
// Pure and dependency-free (a domain file) so the settings UI can validate as
// you type with exactly the rule the server will apply.

/** The bounds. Deliberately generous — the limit should stop a novel, not a
 *  paragraph — and matched by the analyser's own backstop, which truncates
 *  rather than rejects because a slightly-too-long policy should still produce a
 *  review. */
export const LIMITS = {
    instructions: 2000,
    ruleText: 400,
    ruleGlob: 200,
    rules: 20,
} as const

export interface InstructionIssue {
    /** Which field, so the UI can put the message under the right control. */
    field: "instructions" | "glob" | "text" | "rules"
    message: string
    /** Index into the rules array, when the issue is about one rule. */
    index?: number
}

export interface SanitisedInstructions {
    instructions: string
    pathRules: { glob: string; text: string }[]
    /** Non-fatal notes about what was changed on the way in — shown back to the
     *  author so a silently-stripped character never becomes a mystery later. */
    issues: InstructionIssue[]
}

// Characters with no business in a prompt: C0/C1 controls except tab and
// newline, zero-width and bidi-override characters, and the BOM. The bidi ones
// matter most — they can make text render one way to a reviewer approving it and
// another way to whatever consumes it, which is the whole trick behind
// "trojan source".
const STRIP = new RegExp(
    [
        "[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F]", // C0 controls, keeping tab and newline
        "[\\u0080-\\u009F]", // C1 controls
        "[\\u200B-\\u200F]", // zero-width, plus the LTR/RTL marks
        "[\\u202A-\\u202E]", // bidi embedding and override
        "[\\u2066-\\u2069]", // bidi isolates
        "[\\uFEFF]", // BOM / zero-width no-break space
    ].join("|"),
    "g",
)

/** Normalise one block of author-written text. */
function clean(raw: string): { text: string; stripped: boolean } {
    const before = raw
    let text = raw.normalize("NFC").replace(STRIP, "")
    // Collapse runs of blank lines: a wall of whitespace is one of the cheaper
    // ways to push the rules out of a model's attention.
    text = text.replace(/\n{3,}/g, "\n\n").replace(/[ \t]+$/gm, "").trim()
    return { text, stripped: text !== before.normalize("NFC").trim() }
}

function truncate(text: string, max: number): { text: string; cut: boolean } {
    if ([...text].length <= max) return { text, cut: false }
    // By code point, so a cut never lands inside a character.
    return { text: [...text].slice(0, max).join("").trim(), cut: true }
}

/** Validate and normalise the free-text half of a profile.
 *
 *  Never throws and never rejects outright: every problem is corrected and
 *  reported. A settings form that refuses to save because somebody pasted a
 *  zero-width space out of a Google Doc is a form people learn to fight. */
export function sanitiseInstructions(
    rawInstructions: unknown,
    rawRules: unknown,
): SanitisedInstructions {
    const issues: InstructionIssue[] = []

    const base = clean(typeof rawInstructions === "string" ? rawInstructions : "")
    if (base.stripped) {
        issues.push({ field: "instructions", message: "Removed invisible or control characters." })
    }
    const bounded = truncate(base.text, LIMITS.instructions)
    if (bounded.cut) {
        issues.push({ field: "instructions", message: `Trimmed to ${LIMITS.instructions} characters.` })
    }

    const rulesIn = Array.isArray(rawRules) ? rawRules : []
    const pathRules: { glob: string; text: string }[] = []
    for (const [i, entry] of rulesIn.entries()) {
        if (pathRules.length >= LIMITS.rules) {
            issues.push({ field: "rules", message: `Kept the first ${LIMITS.rules} path rules.` })
            break
        }
        const r = (entry ?? {}) as Record<string, unknown>
        const glob = clean(typeof r.glob === "string" ? r.glob : "").text.replace(/\s+/g, "")
        const text = clean(typeof r.text === "string" ? r.text : "")

        // A rule with no glob would apply to everything, and a rule with no text
        // says nothing. Both are almost certainly a half-finished row, so drop
        // them quietly rather than making the author delete them.
        if (!glob || !text.text) continue

        if (glob.length > LIMITS.ruleGlob) {
            issues.push({ field: "glob", index: i, message: "That pattern is too long to be a path." })
            continue
        }
        const boundedText = truncate(text.text, LIMITS.ruleText)
        if (boundedText.cut) {
            issues.push({ field: "text", index: i, message: `Trimmed to ${LIMITS.ruleText} characters.` })
        }
        pathRules.push({ glob, text: boundedText.text })
    }

    return { instructions: bounded.text, pathRules, issues }
}

/** How much of the instruction budget is used, for the character counter. */
export function instructionsRemaining(text: string): number {
    return LIMITS.instructions - [...text].length
}
