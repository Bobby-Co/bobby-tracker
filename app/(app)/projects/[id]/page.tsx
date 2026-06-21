"use client"

import { useEffect } from "react"
import { useParams, useRouter } from "next/navigation"

export default function ProjectIndex() {
    const { id } = useParams<{ id: string }>()
    const router = useRouter()

    useEffect(() => {
        router.replace(`/projects/${id}/issues`)
    }, [id, router])

    return null
}
