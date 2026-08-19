// REVIEW PROFILES — what kind of PR reviewer a team wants.
//
// This file owns the VOCABULARY: which dials exist, what values they take, which
// lenses can be switched on, and what the presets are. The database stores the
// choice (0077); the meaning lives here, so a new dial value is a deploy rather
// than a migration — the same split DuplicateSensitivity uses for its cosine
// thresholds (0072).
//
// PURE AND DEPENDENCY-FREE, and it has to stay that way. The settings UI imports
// it DIRECTLY rather than through the module barrel, because the barrel re-exports
// Composition → infrastructure → lib/server/supabase → next/headers, which fails
// the browser build. A domain file is safe to import from a client component only
// as long as it imports nothing itself.
//
// The analyser has its own copy of this vocabulary (internal/pranalysis/policy.go)
// and treats anything it doesn't recognise as the default, so the two can be
// deployed in either order without a review ever failing. What must NOT drift is
// the meaning of a value that exists on both sides.

// ─── dials ──────────────────────────────────────────────────────────────────

export const STRICTNESS = ["quiet", "balanced", "thorough"] as const
export const EVIDENCE = ["standard", "strict"] as const
export const BLOCKING = ["bugs_only", "bugs_security", "any"] as const
export const POSITIVITY = ["none", "sparing", "encouraging"] as const
export const VERBOSITY = ["terse", "normal", "explanatory"] as const
export const VOICE = ["neutral", "direct", "coaching"] as const
export const DEPTH = ["quick", "standard", "deep"] as const

export type Strictness = (typeof STRICTNESS)[number]
export type EvidenceBar = (typeof EVIDENCE)[number]
export type Blocking = (typeof BLOCKING)[number]
export type Positivity = (typeof POSITIVITY)[number]
export type Verbosity = (typeof VERBOSITY)[number]
export type Voice = (typeof VOICE)[number]
export type Depth = (typeof DEPTH)[number]

export interface Dials {
    strictness: Strictness
    evidence: EvidenceBar
    blocking: Blocking
    positivity: Positivity
    verbosity: Verbosity
    voice: Voice
    depth: Depth
}

/** The reviewer exactly as it behaved before profiles existed. */
export const DEFAULT_DIALS: Dials = {
    strictness: "balanced",
    evidence: "standard",
    blocking: "any",
    positivity: "sparing",
    verbosity: "normal",
    voice: "neutral",
    depth: "standard",
}

/** One dial, described for the settings UI. `effect` is the sentence shown under
 *  the control — it says what the setting DOES, not what it is called, because a
 *  dial whose effect you can't predict is one nobody touches twice. */
export interface DialSpec<T extends string = string> {
    key: keyof Dials
    label: string
    help: string
    options: { value: T; label: string; effect: string }[]
    /** True when this dial changes who is allowed to merge. Surfaced loudly. */
    affectsMerge?: boolean
}

export const DIAL_SPECS: DialSpec[] = [
    {
        key: "strictness",
        label: "Strictness",
        help: "Where the bar sits for something to be worth saying. The verification work is the same either way.",
        options: [
            { value: "quiet", label: "Quiet", effect: "Reports what breaks. Silent on conventions and style. At most 5 findings." },
            { value: "balanced", label: "Balanced", effect: "The default. Defects, plus what a careful reviewer would flag. At most 12." },
            { value: "thorough", label: "Thorough", effect: "Also reports convention and structure. At most 20." },
        ],
    },
    {
        key: "blocking",
        label: "What blocks a merge",
        help: "Findings marked as blockers hold up the merge button in Ucelot. This decides what may be marked that way.",
        affectsMerge: true,
        options: [
            { value: "bugs_only", label: "Defects only", effect: "Only a defect this change introduces can block. Everything else is advisory." },
            { value: "bugs_security", label: "Defects and security", effect: "Defects and security exposures can block." },
            { value: "any", label: "Anything serious", effect: "The default. Any finding severe enough can block." },
        ],
    },
    {
        key: "evidence",
        label: "Evidence for a blocker",
        help: "How much corroboration a finding needs before it is allowed to hold up a merge.",
        affectsMerge: true,
        options: [
            { value: "standard", label: "Standard", effect: "One verified location. The default." },
            { value: "strict", label: "Strict", effect: "Two independent locations — the line and a caller, say. Findings with one become advisory." },
        ],
    },
    {
        key: "positivity",
        label: "Positive notes",
        help: "How much of the review is spent on what the change got right.",
        options: [
            { value: "none", label: "None", effect: "Problems only." },
            { value: "sparing", label: "Sparing", effect: "The default. Up to 2, when genuinely warranted." },
            { value: "encouraging", label: "Encouraging", effect: "Up to 4, each naming the specific decision." },
        ],
    },
    {
        key: "verbosity",
        label: "Detail",
        help: "How much a finding says once it has earned its place.",
        options: [
            { value: "terse", label: "Terse", effect: "One short sentence each." },
            { value: "normal", label: "Normal", effect: "The default." },
            { value: "explanatory", label: "Explanatory", effect: "What breaks, why it breaks here, and the direction of a fix." },
        ],
    },
    {
        key: "voice",
        label: "Voice",
        help: "Tone only. Doesn't change what gets found or how severe it is.",
        options: [
            { value: "neutral", label: "Neutral", effect: "The default." },
            { value: "direct", label: "Direct", effect: "No hedging, no pleasantries." },
            { value: "coaching", label: "Coaching", effect: "Names the pattern behind the problem, for someone learning the codebase." },
        ],
    },
    {
        key: "depth",
        label: "Depth",
        help: "How long the reviewer gets to look. Costs more; doesn't change its opinions.",
        options: [
            { value: "quick", label: "Quick", effect: "Fewer turns, lower spend." },
            { value: "standard", label: "Standard", effect: "The default." },
            { value: "deep", label: "Deep", effect: "More turns for a wider blast radius. Capped by your plan." },
        ],
    },
]

// ─── lenses ─────────────────────────────────────────────────────────────────

/** One focus module. `alwaysOn` marks the three that run regardless — they have
 *  deterministic enforcement behind them analyser-side, so a switch that claimed
 *  to turn them off would be a switch that does nothing. The UI says so. */
export interface LensSpec {
    key: string
    label: string
    help: string
    alwaysOn?: boolean
}

export const LENSES: LensSpec[] = [
    { key: "correctness", label: "Correctness & bugs", help: "Probes each risky change for a concrete failure it doesn't already guard against.", alwaysOn: true },
    { key: "blast_radius", label: "Blast radius", help: "Enumerates the callers of every changed public symbol.", alwaysOn: true },
    { key: "test_gap", label: "Test gaps", help: "Looks for a covering test and names the untested path when there isn't one.", alwaysOn: true },
    { key: "convention", label: "Conventions", help: "Judges against how this repo already does it, citing the exemplar." },
    { key: "drift", label: "Layering drift", help: "Flags a new import that crosses a boundary its neighbours don't." },
    { key: "history", label: "History & regressions", help: "Reads git history for reverts and repeat hot-spots in the changed area." },
    { key: "security", label: "Security", help: "Traces untrusted input to dangerous sinks. Adds a risk summary to the review." },
    { key: "performance", label: "Performance & load", help: "Looks for work that grows with caller-controlled input." },
    { key: "api_contract", label: "API contract", help: "Tabulates changed public signatures, before and after, with their callers." },
    { key: "data_migration", label: "Data & migrations", help: "Checks migrations for reversibility, locking and destructive statements." },
    { key: "dependencies", label: "Dependencies", help: "Reports added and major-bumped packages, and what they're for." },
]

const LENS_KEYS = new Set(LENSES.map((l) => l.key))
const OPTIONAL_LENS_KEYS = LENSES.filter((l) => !l.alwaysOn).map((l) => l.key)

/** The optional lenses that reproduce the reviewer as it behaved before lenses
 *  existed. Its method steps were convention, drift and history; naming them is
 *  what makes lenses purely additive. Must match defaultLensKeys() in the
 *  analyser's policy.go. */
export const DEFAULT_LENSES = ["convention", "drift", "history"]

// ─── presets ────────────────────────────────────────────────────────────────

export interface Preset {
    key: string
    label: string
    tagline: string
    dials: Dials
    lenses: string[]
}

export const PRESETS: Preset[] = [
    {
        key: "balanced",
        label: "Balanced",
        tagline: "Today's reviewer. A good place to start.",
        dials: DEFAULT_DIALS,
        lenses: DEFAULT_LENSES,
    },
    {
        key: "gatekeeper",
        label: "Gatekeeper",
        tagline: "Nothing sloppy gets in. Slower, and it will argue with you.",
        dials: { ...DEFAULT_DIALS, strictness: "thorough", evidence: "strict", blocking: "any", verbosity: "explanatory", depth: "deep" },
        lenses: [...DEFAULT_LENSES, "security", "api_contract", "data_migration"],
    },
    {
        key: "ship_fast",
        label: "Ship fast",
        tagline: "Only tell me if it breaks.",
        dials: { ...DEFAULT_DIALS, strictness: "quiet", blocking: "bugs_only", positivity: "none", verbosity: "terse", voice: "direct", depth: "quick" },
        lenses: [],
    },
    {
        key: "security_hawk",
        label: "Security hawk",
        tagline: "Threat-models every diff. Leads with the risks.",
        dials: { ...DEFAULT_DIALS, strictness: "thorough", blocking: "bugs_security", evidence: "strict", depth: "deep" },
        lenses: ["security", "dependencies", "data_migration", "api_contract", "drift"],
    },
    {
        key: "house_style",
        label: "House style",
        tagline: "Enforces how this codebase already does things.",
        dials: { ...DEFAULT_DIALS, strictness: "thorough", verbosity: "explanatory", voice: "coaching" },
        lenses: ["convention", "drift", "history", "api_contract"],
    },
    {
        key: "mentor",
        label: "Mentor",
        tagline: "Teaches rather than just flags. Good for a growing team.",
        dials: { ...DEFAULT_DIALS, positivity: "encouraging", verbosity: "explanatory", voice: "coaching", blocking: "bugs_only" },
        lenses: [...DEFAULT_LENSES, "test_gap"],
    },
]

export const PRESET_KEYS = PRESETS.map((p) => p.key)

export function presetByKey(key: string | null | undefined): Preset | null {
    return PRESETS.find((p) => p.key === key) ?? null
}

// ─── the profile ────────────────────────────────────────────────────────────

/** A saved profile, as the app works with it. */
export interface ReviewProfile {
    id: string
    team_id: string
    name: string
    preset: string | null
    dials: Dials
    lenses: string[]
    instructions: string
    path_rules: PathRule[]
    created_by: string | null
    updated_by: string | null
    created_at: string
    updated_at: string
}

export interface PathRule {
    glob: string
    text: string
}

/** What crosses the wire to the analyser. Deliberately flat and snake_cased to
 *  match its ReviewPolicy — this IS that struct, so the two are read side by
 *  side when either changes. */
export interface ReviewPolicyWire {
    strictness: Strictness
    evidence: EvidenceBar
    blocking: Blocking
    positivity: Positivity
    verbosity: Verbosity
    voice: Voice
    depth: Depth
    lenses: string[]
    instructions?: string
    path_rules?: PathRule[]
}

// ─── parsing ────────────────────────────────────────────────────────────────

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
    return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : fallback
}

/** Read a stored `dials` blob into a complete, valid Dials. Unknown keys are
 *  ignored and unknown values fall back — a profile written by a newer app must
 *  degrade to a sane reviewer here, never throw, because this runs on the path
 *  that decides whether a PR gets reviewed at all. */
export function parseDials(raw: unknown): Dials {
    const d = (raw ?? {}) as Record<string, unknown>
    return {
        strictness: oneOf(d.strictness, STRICTNESS, DEFAULT_DIALS.strictness),
        evidence: oneOf(d.evidence, EVIDENCE, DEFAULT_DIALS.evidence),
        blocking: oneOf(d.blocking, BLOCKING, DEFAULT_DIALS.blocking),
        positivity: oneOf(d.positivity, POSITIVITY, DEFAULT_DIALS.positivity),
        verbosity: oneOf(d.verbosity, VERBOSITY, DEFAULT_DIALS.verbosity),
        voice: oneOf(d.voice, VOICE, DEFAULT_DIALS.voice),
        depth: oneOf(d.depth, DEPTH, DEFAULT_DIALS.depth),
    }
}

/** Keep only lens keys this build knows, deduped, in catalogue order. Always-on
 *  lenses are dropped from the stored list rather than kept: they run regardless,
 *  and storing them would make an "all off" profile indistinguishable from one
 *  that had merely never been edited. */
export function parseLenses(raw: unknown): string[] {
    const list = Array.isArray(raw) ? raw : []
    const want = new Set(list.filter((k): k is string => typeof k === "string"))
    return OPTIONAL_LENS_KEYS.filter((k) => want.has(k))
}

export function isLensKey(k: string): boolean {
    return LENS_KEYS.has(k)
}

// ─── compiling to the wire ──────────────────────────────────────────────────

/** Compile a profile into the policy the analyser receives.
 *
 *  `null` means the project has no profile, and returns null rather than a
 *  default-valued policy: sending nothing is what an older analyser cell expects,
 *  and it is also what keeps the analyser's prompt cache warm for the common
 *  case — its Brief() only emits the dials that DIFFER from the default, so an
 *  explicit default policy and no policy produce the same prompt anyway. Not
 *  sending it is simply the cheaper way to say the same thing.
 *
 *  `lenses` is ALWAYS emitted, even empty. The analyser distinguishes an absent
 *  lens list ("this caller knows nothing about lenses" → today's reviewer) from
 *  an empty one ("every optional lens off"), and only an explicit key preserves
 *  that distinction through JSON. */
export function compilePolicy(profile: ReviewProfile | null, opts: { maxDepth?: Depth } = {}): ReviewPolicyWire | null {
    if (!profile) return null
    const dials = { ...profile.dials, depth: clampDepth(profile.dials.depth, opts.maxDepth) }
    return {
        ...dials,
        lenses: profile.lenses,
        ...(profile.instructions ? { instructions: profile.instructions } : {}),
        ...(profile.path_rules.length ? { path_rules: profile.path_rules } : {}),
    }
}

const DEPTH_RANK: Record<Depth, number> = { quick: 0, standard: 1, deep: 2 }

/** The deepest review each plan may ask for.
 *
 *  Keyed by a plain STRING rather than billing's `TierId` on purpose. This file
 *  has to stay dependency-free — the settings UI imports it into the browser —
 *  and a type import from the billing barrel would be erased at compile time
 *  today and load `next/headers` the first time somebody made it a value import.
 *  The vocabulary is pinned instead by a test that reads TIER_IDS from billing
 *  and asserts every tier has an entry here, so the two can't drift apart
 *  silently even though nothing imports across the boundary at runtime.
 *
 *  An unknown or missing tier folds to the FLOOR, matching `Tier.of()`, which
 *  folds an unrecognised id to Kit. */
const TIER_MAX_DEPTH: Record<string, Depth> = {
    kit: "quick",
    prowler: "standard",
    pride: "deep",
    apex: "deep",
}

export function maxDepthForTier(tier: string | null | undefined): Depth {
    return (tier && TIER_MAX_DEPTH[tier]) || "quick"
}

/** Hold a profile's depth to what the team's plan allows.
 *
 *  Clamped here rather than refused, because a team that downgrades should get
 *  shallower reviews, not none — and the depth dial is the only one that costs
 *  money, so it is the only one a billing tier has any business touching. */
export function clampDepth(want: Depth, max: Depth | undefined): Depth {
    if (!max) return want
    return DEPTH_RANK[want] > DEPTH_RANK[max] ? max : want
}

// ─── describing a profile ───────────────────────────────────────────────────

/** Whether this profile changes what can block a merge, relative to the default.
 *  Used to warn in the UI: the blocking and evidence dials reach
 *  modules/vcs/domain/MergeGate.ts, which refuses an in-app merge while blockers
 *  exist, so loosening them loosens who may merge what. */
export function affectsMergeGate(dials: Dials): boolean {
    return dials.blocking !== DEFAULT_DIALS.blocking || dials.evidence !== DEFAULT_DIALS.evidence
}

/** Which preset this profile still matches exactly, if any — so the UI can say
 *  "Gatekeeper" rather than "Custom" until something is actually changed. */
export function matchingPreset(dials: Dials, lenses: string[]): Preset | null {
    const key = [...lenses].sort().join(",")
    return (
        PRESETS.find(
            (p) =>
                [...parseLenses(p.lenses)].sort().join(",") === key &&
                (Object.keys(p.dials) as (keyof Dials)[]).every((k) => p.dials[k] === dials[k]),
        ) ?? null
    )
}
