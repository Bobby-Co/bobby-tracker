// Skeleton for the group Issues tab. Mirrors the active layout —
// header stats + action buttons up top, two project subsections with
// their own headers + a small stack of issue-row placeholders.
// Renders inside the group layout (which already streams its own
// header), so this is just the tab-content area.
export function GroupIssuesSkeleton() {
    return (
        <div aria-busy className="flex flex-col gap-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="skeleton h-3.5 w-56" />
                <div className="flex items-center gap-2">
                    <div className="skeleton h-8 w-20 rounded-[10px]" />
                    <div className="skeleton h-8 w-32 rounded-[10px]" />
                    <div className="skeleton h-8 w-24 rounded-[10px]" />
                </div>
            </div>

            <div className="flex flex-col gap-7">
                {[0, 1].map((s) => (
                    <section key={s} className="flex flex-col gap-3">
                        <header className="flex flex-wrap items-baseline justify-between gap-2">
                            <div className="skeleton h-4 w-32" />
                            <div className="skeleton h-3 w-16" />
                        </header>
                        <ul className="flex flex-col gap-2">
                            {[0, 1, 2].map((i) => (
                                <li
                                    key={i}
                                    className="rounded-[12px] border border-[color:var(--c-border)] bg-white px-3 py-3 shadow-[var(--shadow-card)]"
                                >
                                    <div className="flex items-center gap-3">
                                        <div className="skeleton h-3 w-8" />
                                        <div className="skeleton h-3.5 flex-1" />
                                        <div className="skeleton h-5 w-14 rounded-full" />
                                        <div className="skeleton h-5 w-16 rounded-full" />
                                    </div>
                                </li>
                            ))}
                        </ul>
                    </section>
                ))}
            </div>
        </div>
    )
}
