// Skeleton mirrors the live PublicIssueView layout — header strip,
// issue card, AI analysis card — so the hand-off doesn't jump.
export default function PublicIssueDetailLoading() {
    return (
        <main
            aria-busy
            className="mx-auto flex min-h-screen w-full max-w-2xl flex-col gap-5 px-4 py-8 sm:gap-6 sm:px-6 sm:py-12"
        >
            <div className="skeleton h-3 w-32 rounded-full" />
            <div className="skeleton h-3 w-12 rounded-full" />

            <article className="rounded-[14px] border border-[color:var(--c-border)] bg-white p-4 shadow-sm sm:p-6">
                <div className="flex flex-wrap items-center gap-2">
                    <div className="skeleton h-4 w-12 rounded-md" />
                    <div className="skeleton h-4 w-16 rounded-full" />
                    <div className="skeleton h-4 w-14 rounded-full" />
                </div>
                <div className="skeleton mt-3 h-7 w-3/4 rounded-md sm:h-8" />
                <div className="skeleton mt-3 h-3 w-full rounded-full" />
                <div className="skeleton mt-2 h-3 w-11/12 rounded-full" />
                <div className="skeleton mt-2 h-3 w-2/3 rounded-full" />
            </article>

            <section className="rounded-[14px] border border-[color:var(--c-border)] bg-white p-4 shadow-sm sm:p-6">
                <div className="flex items-center justify-between gap-2">
                    <div className="skeleton h-4 w-32 rounded-md" />
                    <div className="skeleton h-8 w-28 rounded-[10px]" />
                </div>
                <div className="mt-4 flex flex-col gap-2">
                    <div className="skeleton h-3 w-full rounded-full" />
                    <div className="skeleton h-3 w-11/12 rounded-full" />
                    <div className="skeleton h-3 w-2/3 rounded-full" />
                </div>
            </section>
        </main>
    )
}
