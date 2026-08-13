// Instant skeleton for the pull-requests list. Shown by the App Router's
// auto-Suspense boundary while page.tsx awaits the pulls query.
export default function Loading() {
    return (
        <div className="flex flex-col gap-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="skeleton h-3.5 w-40" />
                <div className="skeleton h-8 w-20" />
            </div>

            <section>
                <div className="skeleton mb-3 h-3.5 w-16" />
                <div className="flex flex-col gap-2">
                    {[0, 1, 2, 3, 4].map((i) => (
                        <div key={i} className="flex items-center gap-3 rounded-[12px] border border-[color:var(--c-border)] bg-[color:var(--c-surface)] px-4 py-3 shadow-[var(--shadow-card)]">
                            <div className="skeleton h-2 w-2 rounded-full" />
                            <div className="skeleton hidden h-3 w-8 sm:block" />
                            <div className="skeleton h-3.5 flex-1" />
                            <div className="skeleton h-5 w-16" />
                        </div>
                    ))}
                </div>
            </section>
        </div>
    )
}
