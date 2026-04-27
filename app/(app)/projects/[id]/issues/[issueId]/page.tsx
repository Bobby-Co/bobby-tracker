import { notFound } from "next/navigation"
import Link from "next/link"
import { createClient } from "@/lib/supabase/server"
import { IssueDetail } from "@/components/issue-detail"
import type { Issue } from "@/lib/supabase/types"

export const dynamic = "force-dynamic"

export default async function IssueDetailPage({
    params,
}: {
    params: Promise<{ id: string; issueId: string }>
}) {
    const { id, issueId } = await params
    const supabase = await createClient()
    const { data: issue } = await supabase
        .from("issues")
        .select("*")
        .eq("id", issueId)
        .eq("project_id", id)
        .single<Issue>()
    if (!issue) notFound()

    return (
        <div className="flex flex-col gap-4">
            <Link href={`/projects/${id}/issues`} className="text-xs text-zinc-500 hover:underline">
                ← Issues
            </Link>
            <IssueDetail issue={issue} />
        </div>
    )
}
