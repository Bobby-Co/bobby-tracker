// Shared skeleton for the project Ask page. Used by both the route's
// loading.tsx (hard navigations) and the in-page Suspense fallback
// (so soft tab switches pop in instantly without waiting for the
// project_analyser round-trip).
export function AskSkeleton() {
    return (
        <div aria-busy className="flex flex-col gap-4">
            <header>
                <div className="skeleton h-5 w-16" />
                <div className="skeleton mt-2 h-3 w-80 max-w-full" />
            </header>

            <div className="card">
                <div className="skeleton h-2.5 w-16" />
                <div className="skeleton mt-2 h-[78px] w-full rounded-[12px]" />
                <div className="mt-2 flex items-center justify-between gap-3">
                    <div className="skeleton h-3 w-36" />
                    <div className="skeleton h-8 w-16 rounded-[10px]" />
                </div>
            </div>

            <div className="skeleton h-3 w-72 max-w-full" />
        </div>
    )
}
