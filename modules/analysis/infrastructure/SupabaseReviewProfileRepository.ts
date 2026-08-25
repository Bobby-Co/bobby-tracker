// Analysis infrastructure — the Supabase adapter for ReviewProfileRepository.
// The ONLY place that touches tracker.review_profiles and
// tracker.projects.review_profile_id. Swapping persistence means replacing this
// file.

import type { SupabaseClient } from "@supabase/supabase-js"
import { RepositoryError } from "@/lib/shared/kernel"
import { parseDials, parseLenses, type PathRule, type ReviewProfile } from "../domain/ReviewProfile"
import type { ReviewProfileInput, ReviewProfileRepository } from "../ports/ReviewProfileRepository"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = SupabaseClient<any, any, any>

const COLUMNS = "id,team_id,name,preset,dials,lenses,instructions,path_rules,created_by,updated_by,created_at,updated_at"

interface Row {
    id: string
    team_id: string
    name: string
    preset: string | null
    dials: unknown
    lenses: unknown
    instructions: string | null
    path_rules: unknown
    created_by: string | null
    updated_by: string | null
    created_at: string
    updated_at: string
}

/** Row → domain. Every field is parsed through the domain rather than trusted:
 *  a profile written by a NEWER app must degrade to a sane reviewer here, not
 *  throw, because this runs on the path that decides whether a PR gets reviewed
 *  at all. A settings page rendering slightly stale options is recoverable; a
 *  webhook throwing on an unknown dial value is a PR that never gets a review. */
function toDomain(r: Row): ReviewProfile {
    return {
        id: r.id,
        team_id: r.team_id,
        name: r.name,
        preset: r.preset,
        dials: parseDials(r.dials),
        lenses: parseLenses(r.lenses),
        instructions: r.instructions ?? "",
        path_rules: parsePathRules(r.path_rules),
        created_by: r.created_by,
        updated_by: r.updated_by,
        created_at: r.created_at,
        updated_at: r.updated_at,
    }
}

function parsePathRules(raw: unknown): PathRule[] {
    if (!Array.isArray(raw)) return []
    const out: PathRule[] = []
    for (const entry of raw) {
        const r = (entry ?? {}) as Record<string, unknown>
        if (typeof r.glob === "string" && typeof r.text === "string" && r.glob && r.text) {
            out.push({ glob: r.glob, text: r.text })
        }
    }
    return out
}

function toRow(input: ReviewProfileInput) {
    return {
        name: input.name,
        preset: input.preset,
        dials: input.dials,
        lenses: input.lenses,
        instructions: input.instructions,
        path_rules: input.pathRules,
    }
}

export class SupabaseReviewProfileRepository implements ReviewProfileRepository {
    constructor(private readonly db: AnyDb) {}

    async listForTeam(teamId: string): Promise<ReviewProfile[]> {
        const { data, error } = await this.db
            .from("review_profiles")
            .select(COLUMNS)
            .eq("team_id", teamId)
            .order("created_at", { ascending: false })
        if (error) throw new RepositoryError(error.message, { cause: error })
        return ((data as Row[] | null) ?? []).map(toDomain)
    }

    async find(teamId: string, id: string): Promise<ReviewProfile | null> {
        // Filtered by team AND id: a stray id from another tenant reads as "not
        // found" rather than as a permission error, so the caller can't use this
        // to discover that somebody else's profile exists.
        const { data, error } = await this.db
            .from("review_profiles")
            .select(COLUMNS)
            .eq("team_id", teamId)
            .eq("id", id)
            .maybeSingle<Row>()
        if (error) throw new RepositoryError(error.message, { cause: error })
        return data ? toDomain(data) : null
    }

    async findForProject(projectId: string): Promise<ReviewProfile | null> {
        // Two round trips rather than a join, because the join would have to
        // cross the control/data plane split for a project row that may live in
        // another cell. Both are indexed single-row lookups.
        const { data: proj, error: projErr } = await this.db
            .from("projects")
            .select("review_profile_id")
            .eq("id", projectId)
            .maybeSingle<{ review_profile_id: string | null }>()
        if (projErr) throw new RepositoryError(projErr.message, { cause: projErr })
        if (!proj?.review_profile_id) return null // the normal case: the default reviewer

        const { data, error } = await this.db
            .from("review_profiles")
            .select(COLUMNS)
            .eq("id", proj.review_profile_id)
            .maybeSingle<Row>()
        if (error) throw new RepositoryError(error.message, { cause: error })
        return data ? toDomain(data) : null
    }

    async create(teamId: string, input: ReviewProfileInput): Promise<ReviewProfile> {
        const { data, error } = await this.db
            .from("review_profiles")
            .insert({ ...toRow(input), team_id: teamId, created_by: input.actorId, updated_by: input.actorId })
            .select(COLUMNS)
            .single<Row>()
        if (error) throw new RepositoryError(error.message, { cause: error })
        return toDomain(data)
    }

    async update(teamId: string, id: string, input: ReviewProfileInput): Promise<ReviewProfile | null> {
        const { data, error } = await this.db
            .from("review_profiles")
            .update({ ...toRow(input), updated_by: input.actorId })
            .eq("team_id", teamId)
            .eq("id", id)
            .select(COLUMNS)
            .maybeSingle<Row>()
        if (error) throw new RepositoryError(error.message, { cause: error })
        return data ? toDomain(data) : null
    }

    async remove(teamId: string, id: string): Promise<void> {
        const { error } = await this.db.from("review_profiles").delete().eq("team_id", teamId).eq("id", id)
        if (error) throw new RepositoryError(error.message, { cause: error })
    }

    async assign(projectId: string, profileId: string | null): Promise<void> {
        const { error } = await this.db.from("projects").update({ review_profile_id: profileId }).eq("id", projectId)
        if (error) throw new RepositoryError(error.message, { cause: error })
    }
}

export function createSupabaseReviewProfileRepository(db: AnyDb): ReviewProfileRepository {
    return new SupabaseReviewProfileRepository(db)
}
