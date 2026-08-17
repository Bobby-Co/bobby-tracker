// Projects module — per-project DISPLAY settings persistence PORT
// (project_label_icons + project_status_colors: the label→icon map and the
// status-color overrides the timeline/board render with). RLS-scoped to the
// project's owner/team.

import type { ProjectLabelIcon, ProjectStatusColor } from "@/lib/shared/types"

export interface ProjectDisplayRepository {
    /** The project's label→icon mappings. THROWS RepositoryError. */
    listLabelIcons(projectId: string): Promise<ProjectLabelIcon[]>
    /** Upsert one label→icon mapping; returns the row. THROWS. */
    upsertLabelIcon(projectId: string, label: string, iconName: string, color: string | null): Promise<ProjectLabelIcon>
    /** Delete one label mapping. THROWS. */
    deleteLabelIcon(projectId: string, label: string): Promise<void>

    /** The project's status-color overrides. THROWS. */
    listStatusColors(projectId: string): Promise<ProjectStatusColor[]>
    /** Upsert one status-color override; returns the row. THROWS. */
    upsertStatusColor(projectId: string, status: string, color: string): Promise<ProjectStatusColor>
}
