// Projects infrastructure — the Supabase adapter for ProjectDisplayRepository. The
// only place that touches project_label_icons / project_status_colors. Bound to
// the caller's RLS-scoped client. (Icon-name / colour validation stays in the
// route — it's request-shape validation, not persistence.)

import type { SupabaseClient } from "@supabase/supabase-js"
import { RepositoryError } from "@/lib/shared/kernel"
import type { ProjectLabelIcon, ProjectStatusColor } from "@/lib/shared/types"
import type { ProjectDisplayRepository } from "../ports/ProjectDisplayRepository"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = SupabaseClient<any, any, any>

export class SupabaseProjectDisplayRepository implements ProjectDisplayRepository {
    constructor(private readonly db: AnyDb) {}

    async listLabelIcons(projectId: string): Promise<ProjectLabelIcon[]> {
        const { data, error } = await this.db
            .from("project_label_icons")
            .select("*")
            .eq("project_id", projectId)
            .returns<ProjectLabelIcon[]>()
        if (error) throw new RepositoryError(error.message, { cause: error })
        return data ?? []
    }

    async upsertLabelIcon(projectId: string, label: string, iconName: string, color: string | null): Promise<ProjectLabelIcon> {
        const { data, error } = await this.db
            .from("project_label_icons")
            .upsert({ project_id: projectId, label, icon_name: iconName, color }, { onConflict: "project_id,label" })
            .select("*")
            .single<ProjectLabelIcon>()
        if (error) throw new RepositoryError(error.message, { cause: error })
        return data
    }

    async deleteLabelIcon(projectId: string, label: string): Promise<void> {
        const { error } = await this.db.from("project_label_icons").delete().eq("project_id", projectId).eq("label", label)
        if (error) throw new RepositoryError(error.message, { cause: error })
    }

    async listStatusColors(projectId: string): Promise<ProjectStatusColor[]> {
        const { data, error } = await this.db
            .from("project_status_colors")
            .select("*")
            .eq("project_id", projectId)
            .returns<ProjectStatusColor[]>()
        if (error) throw new RepositoryError(error.message, { cause: error })
        return data ?? []
    }

    async upsertStatusColor(projectId: string, status: string, color: string): Promise<ProjectStatusColor> {
        const { data, error } = await this.db
            .from("project_status_colors")
            .upsert({ project_id: projectId, status, color }, { onConflict: "project_id,status" })
            .select("*")
            .single<ProjectStatusColor>()
        if (error) throw new RepositoryError(error.message, { cause: error })
        return data
    }
}

/** Composition seam: bind a ProjectDisplayRepository to a specific client. */
export function createSupabaseProjectDisplayRepository(db: AnyDb): ProjectDisplayRepository {
    return new SupabaseProjectDisplayRepository(db)
}
