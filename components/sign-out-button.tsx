"use client"

export function SignOutButton({ email }: { email?: string | null }) {
    return (
        <form action="/auth/sign-out" method="post" className="flex items-center gap-2">
            {email && <span className="truncate text-xs text-zinc-500">{email}</span>}
            <button
                type="submit"
                className="rounded-md border border-zinc-200 px-2 py-1 text-xs text-zinc-600 hover:bg-zinc-100 dark:border-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-900"
            >
                Sign out
            </button>
        </form>
    )
}
