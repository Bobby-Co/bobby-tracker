// Custom 404 for the public-submission flow. Triggered whenever any
// route under /p/[token]/* calls notFound() — invalid / disabled
// token, missing issue id, or an issue the visitor isn't allowed to
// see (own-visibility filter). The copy is intentionally generic so
// the page doesn't leak which of those reasons applies.
export default function PublicSessionNotFound() {
    return (
        <main className="mx-auto flex min-h-screen w-full max-w-md flex-col items-center justify-center gap-5 px-4 py-12 sm:px-6">
            <div className="anim-fade flex w-full flex-col items-center gap-4 rounded-[16px] border border-[color:var(--c-border)] bg-white p-6 text-center shadow-[var(--shadow-card)] sm:p-8">
                <span className="grid h-12 w-12 place-items-center rounded-full bg-zinc-100 text-zinc-700">
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                        <circle cx="12" cy="12" r="9" />
                        <path d="M9 9l6 6M15 9l-6 6" />
                    </svg>
                </span>

                <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-[color:var(--c-text-muted)]">
                    Public submission
                </div>

                <h1 className="text-[20px] font-bold leading-tight tracking-[-0.012em]">
                    Link not found
                </h1>

                <p className="text-[13px] leading-relaxed text-[color:var(--c-text-muted)]">
                    This submission link is invalid or no longer active. Double-check the URL, or reach out to whoever shared it for an updated link.
                </p>

                <p className="text-[12px] text-[color:var(--c-text-dim)]">
                    Common reasons: the owner deleted or paused the session, the URL was copy-pasted incompletely, or the link has been regenerated.
                </p>
            </div>

            <footer className="text-center text-[11px] text-[color:var(--c-text-dim)]">
                Bobby Tracker · public submission
            </footer>
        </main>
    )
}
