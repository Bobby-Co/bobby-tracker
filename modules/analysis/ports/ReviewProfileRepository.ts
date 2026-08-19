// Analysis port — persistence for review profiles (migration 0077).
//
// A profile is TEAM-owned and PROJECT-assigned, so this role has two shapes of
// read: the library (what can this team choose from) and the resolution (what
// does this project actually review under). They are separate methods rather
// than one, because the resolution runs on the hot path — every webhook that
// starts a review — and wants exactly one row, not a list to search.

import type { ReviewProfile } from "../domain/ReviewProfile"

/** The fields a caller supplies when creating or updating a profile. The domain
 *  has already validated the dials and sanitised the text by this point; a
 *  repository takes clean input and stores it. */
export interface ReviewProfileInput {
    name: string
    preset: string | null
    dials: Record<string, string>
    lenses: string[]
    instructions: string
    pathRules: { glob: string; text: string }[]
    /** Whoever is making the change. Stored as updated_by so a review that got
     *  quieter can be traced to the edit that did it. */
    actorId: string | null
}

export interface ReviewProfileRepository {
    /** Every profile this team can choose from, newest first. */
    listForTeam(teamId: string): Promise<ReviewProfile[]>

    /** One profile by id, scoped to its team so a stray id can't read across
     *  tenants. Null when it doesn't exist or belongs to somebody else — the
     *  caller cannot tell the two apart, which is the point. */
    find(teamId: string, id: string): Promise<ReviewProfile | null>

    /** The profile a PROJECT reviews under, or null for the built-in default.
     *  Null is the normal case, not an error: no project has one until somebody
     *  assigns it. */
    findForProject(projectId: string): Promise<ReviewProfile | null>

    create(teamId: string, input: ReviewProfileInput): Promise<ReviewProfile>
    update(teamId: string, id: string, input: ReviewProfileInput): Promise<ReviewProfile | null>

    /** Delete a profile. Projects pointing at it fall back to the default rather
     *  than breaking (ON DELETE SET NULL), so this is safe to offer. */
    remove(teamId: string, id: string): Promise<void>

    /** Point a project at a profile, or at null for the built-in default. The
     *  profile must belong to the project's team; the caller checks that. */
    assign(projectId: string, profileId: string | null): Promise<void>
}
