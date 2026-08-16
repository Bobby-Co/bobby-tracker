// Regions domain — the RegionId value object. PURE: no I/O, no env, no SDK.
//
// A REGION is the coarse, user-facing geography: `north-america`,
// `south-east-asia`. It is what a customer chooses and what a residency question
// is answered in. It is NOT what the app routes on — see CellId for that.
//
// Deliberately an OPEN type validated by FORMAT, not a closed union of known
// values. Adding `east-asia` must cost an env change, not a code change plus a
// migration plus a deploy; whether a region actually exists is a question for the
// registry (which reads config), not for the type system.

/** Branded so a region and a cell can't be passed for one another. They are both
 *  lowercase slugs and flow through the same call sites, which is exactly the
 *  mix-up worth making impossible. */
export type RegionId = string & { readonly __brand: "RegionId" }

/** Lowercase slug: letters/digits in hyphen-separated segments, leading letter.
 *  Matches `north-america`, `south-east-asia`, `eu-west`. */
const SLUG = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/

export function isRegionId(value: unknown): value is RegionId {
    return typeof value === "string" && value.length <= 64 && SLUG.test(value)
}

/** Narrow an untrusted string (a DB column, an env var, a request body).
 *
 *  Returns null rather than falling back: silently substituting a default region
 *  would place a customer's data in a geography they did not choose. Callers
 *  decide what an unusable value means; all of them need to know it happened. */
export function parseRegionId(value: string | null | undefined): RegionId | null {
    return isRegionId(value) ? value : null
}

/** `south-east-asia` → `South East Asia`. Derived rather than looked up, so a new
 *  region needs no code edit; the registry lets config override it where the
 *  derived form reads badly. */
export function deriveRegionLabel(region: RegionId): string {
    return region
        .split("-")
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" ")
}
