// Instant skeleton for issue detail. Streams while the page awaits
// issue + project + analyser + suggestion in parallel.
export default function Loading() {
    return (
        <div className="flex flex-col gap-4">
            <div className="skeleton h-3 w-20" />

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_240px]">
                <article className="min-w-0">
                    <div className="flex items-center gap-2">
                        <div className="skeleton h-3 w-8" />
                        <div className="skeleton h-5 w-16" />
                        <div className="skeleton h-5 w-14" />
                    </div>
                    <div className="skeleton mt-3 h-7 w-3/4" />
                    <div className="skeleton mt-2 h-3 w-40" />

                    <section className="mt-6 rounded-[16px] border border-[color:var(--c-border)] bg-white p-4 shadow-[var(--shadow-card)]">
                        <div className="mb-3 flex items-center justify-between">
                            <div className="skeleton h-3.5 w-24" />
                            <div className="skeleton h-6 w-12" />
                        </div>
                        <div className="flex flex-col gap-2">
                            <div className="skeleton h-3 w-full" />
                            <div className="skeleton h-3 w-11/12" />
                            <div className="skeleton h-3 w-2/3" />
                        </div>
                    </section>
                </article>

                <aside className="flex flex-col gap-4">
                    {[0, 1, 2].map((i) => (
                        <div key={i} className="flex flex-col gap-1.5">
                            <div className="skeleton h-2.5 w-16" />
                            <div className="skeleton h-8 w-full" />
                        </div>
                    ))}
                </aside>
            </div>

            <section className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
                <div className="flex items-start justify-between gap-3">
                    <div className="flex flex-col gap-1.5">
                        <div className="skeleton h-3.5 w-44" />
                        <div className="skeleton h-2.5 w-64" />
                    </div>
                    <div className="skeleton h-9 w-28" />
                </div>
            </section>
        </div>
    )
}
