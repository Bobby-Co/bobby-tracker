// Instant skeleton for integrations. Streams while the page awaits
// the project_analyser row.
export default function Loading() {
    return (
        <div className="flex flex-col gap-4">
            <header>
                <div className="skeleton h-5 w-32" />
                <div className="skeleton mt-2 h-3 w-72" />
            </header>

            <div className="card">
                <div className="card-title">
                    <div className="skeleton h-4 w-4 rounded" />
                    <div className="skeleton h-4 w-32" />
                    <div className="skeleton ml-2 h-5 w-16 rounded-full" />
                    <span className="ml-auto" />
                    <div className="skeleton h-7 w-20" />
                </div>
                <div className="skeleton mt-2 h-3 w-3/4" />

                <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
                    {[0, 1, 2, 3].map((i) => (
                        <div key={i} className="flex flex-col gap-1.5">
                            <div className="skeleton h-2.5 w-16" />
                            <div className="skeleton h-3.5 w-24" />
                        </div>
                    ))}
                </div>
            </div>

            <div className="rounded-[16px] border border-dashed border-[color:var(--c-border)] bg-white p-5">
                <div className="skeleton h-3.5 w-40" />
                <div className="skeleton mt-2 h-3 w-64" />
            </div>
        </div>
    )
}
