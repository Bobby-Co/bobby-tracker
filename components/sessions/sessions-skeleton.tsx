// Shared skeleton for the public-sessions list. Used by both the
// route's loading.tsx (hard navigations) and the in-page Suspense
// fallback so soft tab switches paint the skeleton instantly instead
// of stalling on the Supabase round-trip.
export function SessionsSkeleton() {
    return (
        <div aria-busy className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6 sm:py-10">
            <header className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                    <div className="skeleton h-6 w-48" />
                    <div className="skeleton mt-2 h-3 w-80 max-w-full" />
                </div>
                <div className="skeleton h-9 w-32 rounded-[10px]" />
            </header>

            <ul className="mt-6 flex flex-col gap-3">
                {[0, 1, 2].map((i) => (
                    <li
                        key={i}
                        className="rounded-[14px] border border-[color:var(--c-border)] bg-white p-4"
                    >
                        <div className="flex flex-wrap items-start justify-between gap-2">
                            <div className="min-w-0 flex flex-1 items-center gap-2">
                                <div className="skeleton h-4 w-40" />
                                <div className="skeleton h-4 w-12 rounded-full" />
                            </div>
                            <div className="skeleton h-3 w-24" />
                        </div>
                        <div className="skeleton mt-2 h-3 w-3/4" />
                        <div className="mt-3 flex flex-wrap gap-1.5">
                            <div className="skeleton h-5 w-20 rounded-full" />
                            <div className="skeleton h-5 w-16 rounded-full" />
                            <div className="skeleton h-5 w-24 rounded-full" />
                        </div>
                    </li>
                ))}
            </ul>
        </div>
    )
}
