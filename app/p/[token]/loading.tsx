// Skeleton shown while the server component fetches the session +
// project. Mirrors the live layout so there's no jump on hand-off.
export default function PublicSessionLoading() {
    return (
        <main
            aria-busy
            className="mx-auto flex min-h-screen w-full max-w-2xl flex-col gap-5 px-4 py-8 sm:gap-6 sm:px-6 sm:py-12"
        >
            <header>
                <div className="skeleton h-3 w-32 rounded-full" />
                <div className="skeleton mt-3 h-7 w-3/4 rounded-md sm:h-9" />
                <div className="skeleton mt-3 h-3 w-full rounded-full" />
                <div className="skeleton mt-2 h-3 w-5/6 rounded-full" />
            </header>

            <div className="flex flex-col gap-3 rounded-[14px] border border-[color:var(--c-border)] bg-white p-4 shadow-sm sm:p-6">
                <div className="skeleton h-3 w-20 rounded-full" />
                <div className="skeleton h-9 w-full rounded-[12px]" />
                <div className="skeleton mt-2 h-3 w-12 rounded-full" />
                <div className="skeleton h-9 w-full rounded-[12px]" />
                <div className="skeleton mt-2 h-3 w-16 rounded-full" />
                <div className="skeleton h-28 w-full rounded-[12px]" />
                <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div className="skeleton h-9 w-full rounded-[12px] sm:w-40" />
                    <div className="skeleton h-9 w-full rounded-[10px] sm:w-32" />
                </div>
            </div>

            <div className="mx-auto h-3 w-40 rounded-full bg-transparent" />
        </main>
    )
}
