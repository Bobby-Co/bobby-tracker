"use client"

import { useEffect } from "react"
import { useParams, useRouter } from "next/navigation"

// Group root: send users straight to Issues, the primary action
// surface. Settings sits under /groups/[id]/settings.
export default function GroupIndex() {
    const { id } = useParams<{ id: string }>()
    const router = useRouter()

    useEffect(() => {
        router.replace(`/groups/${id}/issues`)
    }, [id, router])

    return null
}
