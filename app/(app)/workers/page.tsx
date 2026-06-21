"use client"

import { RelayWorkersClient } from "@/components/relay-workers-client"

// Auth is handled by the (app)/layout shell. The page is a thin wrapper —
// all interactivity (polling, pairing, rename/unlink) lives in the client
// component, which fetches GET /api/relay/workers itself. Container/padding
// mirrors app/(app)/projects/page.tsx.
export default function WorkersPage() {
    return (
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6 sm:px-6 sm:py-10">
            <RelayWorkersClient />
        </div>
    )
}
