// Shared skeleton for the public submission page. Used by both the
// route's loading.tsx (initial paint, hard navigations) and the
// Suspense fallback inside page.tsx (so soft navigations also pop in
// instantly without waiting for the data fetch).
export function PublicSessionSkeleton() {
    return (
        <main
            aria-busy
            className="mx-auto flex min-h-screen w-full max-w-2xl flex-col gap-5 px-4 py-8 sm:gap-6 sm:px-6 sm:py-12"
        >
            <header className="flex flex-col gap-3">
                <div className="flex items-center gap-2">
                    <div className="skeleton h-5 w-5 rounded-md" />
                    <div className="skeleton h-3 w-32 rounded-full" />
                </div>
                <div>
                    <div className="skeleton h-7 w-3/4 rounded-md sm:h-9" />
                    <div className="skeleton mt-3 h-3 w-full rounded-full" />
                    <div className="skeleton mt-2 h-3 w-5/6 rounded-full" />
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                    <div className="skeleton h-3 w-12 rounded-full" />
                    <div className="skeleton h-5 w-20 rounded-full" />
                    <div className="skeleton h-5 w-16 rounded-full" />
                </div>
                <div className="skeleton h-9 w-48 rounded-full" />
            </header>

            <div className="flex flex-col gap-3 rounded-[14px] border border-[color:var(--c-border)] bg-white p-4 shadow-sm sm:p-6">
                <div className="skeleton h-3 w-16 rounded-full" />
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
