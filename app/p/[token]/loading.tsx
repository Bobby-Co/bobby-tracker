import { PublicSessionSkeleton } from "@/components/public-session-skeleton"

// Route-level loading. Fires on hard navigations (initial visit,
// reload). Soft client navigations (back from issue detail) hit the
// Suspense boundary inside page.tsx, which uses the same skeleton so
// the experience is identical either way.
export default function PublicSessionLoading() {
    return <PublicSessionSkeleton />
}
