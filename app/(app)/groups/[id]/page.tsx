import { redirect } from "next/navigation"

// Group root: send users straight to Issues, the primary action
// surface. Settings sits under /groups/[id]/settings.
export default async function GroupIndex({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    redirect(`/groups/${id}/issues`)
}
