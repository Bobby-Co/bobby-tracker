// How eagerly a project flags one issue as a likely duplicate of another.
//
// The names are the product surface; the cosine thresholds are a tuning detail
// that lives here rather than in the database (0072). That split matters more
// than it looks: embedding models shift the whole similarity distribution, so a
// stored 0.80 would quietly change meaning the day the model changes, while a
// stored 'medium' keeps meaning "the default" and this file is retuned once.
//
// THE INVERSION. Low sensitivity is a HIGH threshold. "Low" is fussy and flags
// almost nothing; "veryhigh" is eager and will flag issues that merely share a
// subject. Everywhere this is presented to a user, say what changes — more
// matches, more of them wrong — rather than the direction of a number.

export const DUPLICATE_SENSITIVITIES = ["low", "medium", "high", "veryhigh"] as const
export type DuplicateSensitivity = (typeof DUPLICATE_SENSITIVITIES)[number]

export const DEFAULT_DUPLICATE_SENSITIVITY: DuplicateSensitivity = "medium"

/** Cosine similarity at or above which a match counts as a likely duplicate. */
const THRESHOLDS: Record<DuplicateSensitivity, number> = {
    low: 0.9,
    medium: 0.8,
    high: 0.7,
    veryhigh: 0.65,
}

/** Copy for the settings UI. `caution` is non-null exactly when the level is
 *  loose enough that the user should expect wrong matches — the UI renders it as
 *  a warning, so adding a level without deciding this is a visible omission
 *  rather than a silent default. */
export const SENSITIVITY_COPY: Record<
    DuplicateSensitivity,
    { label: string; detail: string; caution: string | null }
> = {
    low: {
        label: "Low",
        detail: "Only near-identical issues are flagged.",
        caution: null,
    },
    medium: {
        label: "Medium",
        detail: "Balanced — the default.",
        caution: null,
    },
    high: {
        label: "High",
        detail: "Flags more possible duplicates.",
        caution: "You'll see some matches that aren't really duplicates.",
    },
    veryhigh: {
        label: "Very high",
        detail: "Flags anything closely related.",
        caution: "Expect noticeably more false positives — issues that share a topic but aren't duplicates.",
    },
}

/** Narrow an untrusted value (a database column, a request body) to a level.
 *
 *  Unknown values fall back to the default rather than throwing. The column is
 *  CHECK-constrained, so an unknown value here means someone widened the
 *  constraint without updating this file — and degrading to the default beats
 *  500ing every similarity lookup on the project. */
export function parseDuplicateSensitivity(value: unknown): DuplicateSensitivity {
    return typeof value === "string" && (DUPLICATE_SENSITIVITIES as readonly string[]).includes(value)
        ? (value as DuplicateSensitivity)
        : DEFAULT_DUPLICATE_SENSITIVITY
}

/** The cosine threshold for a level. Accepts untrusted input for convenience —
 *  callers usually hold a raw column value. */
export function duplicateThreshold(value: unknown): number {
    return THRESHOLDS[parseDuplicateSensitivity(value)]
}
