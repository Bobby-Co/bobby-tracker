"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { useAuth } from "@/lib/auth/auth-context"

// Client sign-out: clears the session via the browser Supabase client
// (which removes the auth cookie and notifies the auth context), then
// sends the user to /login. Replaces the old POST to /auth/sign-out.
export function SignOutButton() {
    const { user, signOut } = useAuth()
    const router = useRouter()
    const [pending, setPending] = useState(false)

    async function onClick() {
        setPending(true)
        await signOut()
        router.replace("/login")
    }

    return (
        <div className="flex items-center gap-2.5">
            {user?.email && (
                <span className="hidden truncate text-[12px] text-[color:var(--c-text-muted)] sm:inline">
                    {user.email}
                </span>
            )}
            <button
                type="button"
                onClick={onClick}
                disabled={pending}
                className="rounded-[8px] border border-[color:var(--c-border)] bg-white px-2.5 py-1 text-[11.5px] font-semibold text-[color:var(--c-text-muted)] transition-colors hover:border-[color:var(--c-border-strong)] hover:text-[color:var(--c-text)] disabled:opacity-60"
            >
                {pending ? "Signing out…" : "Sign out"}
            </button>
        </div>
    )
}
