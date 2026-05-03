import { KnowledgeSkeleton } from "@/components/knowledge-skeleton"

// Route-level loading. Fires on hard navigations (initial visit,
// reload). Soft client navigations between project tabs hit the
// Suspense boundary inside page.tsx, which uses the same skeleton so
// the experience is identical either way.
export default function KnowledgeLoading() {
    return <KnowledgeSkeleton />
}
