"use client"

import { useParams } from "next/navigation"
import { useApi } from "@/lib/hooks/use-api"
import type { ProjectGroup } from "@/lib/supabase/types"
import { GroupManagePanel } from "@/components/group-manage-panel"
import { GroupSettingsSkeleton } from "@/components/group-settings-skeleton"

interface MemberInfo {
    id: string
    name: string
    has_summary: boolean
}
interface ProjectOption {
    id: string
    name: string
}

// Settings tab: name / description / member CRUD / delete. The
// header is owned by the group layout, so this page only renders
// the management panel itself.
export default function GroupSettingsPage() {
    const { id } = useParams<{ id: string }>()
    const { data, error, loading } = useApi<{
        group: ProjectGroup
        members: MemberInfo[]
        allProjects: ProjectOption[]
    }>(`/api/groups/${id}`)

    if (loading) return <GroupSettingsSkeleton />

    if (error || !data) {
        return (
            <div className="rounded-[12px] border border-rose-200 bg-rose-50 px-4 py-3 text-[12.5px] text-rose-800">
                {error ?? "Group not found."}
            </div>
        )
    }

    return (
        <GroupManagePanel
            group={data.group}
            members={data.members}
            allProjects={data.allProjects}
        />
    )
}
