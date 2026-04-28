// Instant skeleton for the issues list. Shown by the App Router's
// auto-Suspense boundary while page.tsx awaits the issues query.
export default function Loading() {
    return (
        <div className="flex flex-col gap-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="skeleton h-3.5 w-40" />
                <div className="flex items-center gap-2">
                    <div className="skeleton h-8 w-20" />
                    <div className="skeleton h-8 w-28" />
                </div>
            </div>

            <section>
                <div className="skeleton mb-3 h-3.5 w-16" />
                <ul className="overflow-hidden rounded-[16px] border border-[color:var(--c-border)] bg-white shadow-[var(--shadow-card)] divide-y divide-[color:var(--c-border)]">
                    {[0, 1, 2, 3, 4].map((i) => (
                        <li key={i} className="flex items-center gap-3 px-4 py-3">
                            <div className="skeleton hidden h-3 w-8 sm:block" />
                            <div className="skeleton h-3.5 flex-1" />
                            <div className="skeleton hidden h-5 w-14 sm:block" />
                            <div className="skeleton h-5 w-16" />
                        </li>
                    ))}
                </ul>
            </section>
        </div>
    )
}
