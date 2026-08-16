// Regions domain — the CellId value object. PURE: no I/O, no env, no SDK.
//
// A CELL is one deployment unit inside a region: `ashburn-0`, `bangkok-0`,
// `bangkok-1`. It is what the app actually ROUTES on — a cell has exactly one
// analyser behind it, and a project's knowledge graph lives in exactly one cell.
//
// Cells are internal. A customer chooses a REGION and is never shown a cell; the
// registry places them (see assignCell). That split is what lets capacity be
// added — a second Bangkok cell — without asking anyone to make a decision, and
// what keeps a residency answer meaningful when it is.
//
// Open type validated by FORMAT, for the same reason as RegionId: adding a cell
// must cost an env change and nothing else.

/** Branded so a cell can't be passed where a region is expected, or vice versa. */
export type CellId = string & { readonly __brand: "CellId" }

/** Lowercase slug, same shape as a region. Conventionally `<place>-<ordinal>`,
 *  but the ordinal is convention rather than rule — nothing parses it. */
const SLUG = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/

export function isCellId(value: unknown): value is CellId {
    return typeof value === "string" && value.length <= 64 && SLUG.test(value)
}

/** Narrow an untrusted string. Null rather than a fallback: routing to a
 *  guessed cell reaches an analyser that has never indexed the repo, which
 *  answers with a confident empty result instead of an error — the worst
 *  possible outcome, especially for an agent acting on it. */
export function parseCellId(value: string | null | undefined): CellId | null {
    return isCellId(value) ? value : null
}

/** `bangkok-0` → `Bangkok 0`. Derived; config may override. */
export function deriveCellLabel(cell: CellId): string {
    return cell
        .split("-")
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" ")
}
