// Instant skeleton for the projects index. Streams while the page
// awaits the projects list.
export default function Loading() {
    return (
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-6 sm:px-6 sm:py-10">
            <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between sm:gap-4">
                <div className="min-w-0 flex flex-col gap-2">
                    <div className="skeleton h-7 w-32" />
                    <div className="skeleton h-3 w-80" />
                </div>
                <div className="skeleton h-9 w-32 self-start sm:self-auto" />
            </header>

            <ul
                className="grid gap-3"
                style={{ gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))" }}
            >
                {[0, 1, 2, 3].map((i) => (
                    <li
                        key={i}
                        className="flex flex-col gap-3 rounded-[16px] border border-[color:var(--c-border)] bg-white p-4 shadow-[var(--shadow-card)]"
                    >
                        <div className="flex items-center gap-2">
                            <div className="skeleton h-5 w-5 rounded" />
                            <div className="skeleton h-4 w-32" />
                        </div>
                        <div className="skeleton h-9 w-full rounded-[12px]" />
                        <div className="skeleton h-3 w-2/3" />
                        <div className="skeleton mt-1 h-3 w-20" />
                    </li>
                ))}
            </ul>
        </div>
    )
}
