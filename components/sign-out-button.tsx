"use client"

export function SignOutButton({ email }: { email?: string | null }) {
    return (
        <form action="/auth/sign-out" method="post" className="flex items-center gap-2.5">
            {email && (
                <span className="hidden truncate text-[12px] text-[color:var(--c-text-muted)] sm:inline">
                    {email}
                </span>
            )}
            <button
                type="submit"
                className="rounded-[8px] border border-[color:var(--c-border)] bg-white px-2.5 py-1 text-[11.5px] font-semibold text-[color:var(--c-text-muted)] transition-colors hover:border-[color:var(--c-border-strong)] hover:text-[color:var(--c-text)]"
            >
                Sign out
            </button>
        </form>
    )
}
