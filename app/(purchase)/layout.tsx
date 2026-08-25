"use client"

import Link from "next/link"
import { TeamProvider } from "@/lib/client/auth/team-context"
import { AuthGuard } from "@/components/layout/auth-guard"

// The purchase flow, outside the app shell entirely.
//
// No sidebar, no team switcher, no settings tabs — choosing and paying for a plan
// is a transaction with a beginning and an end, and every piece of navigation on
// the page is an invitation to abandon it halfway. This is the same reason
// checkout pages across the industry are stripped down; it is not a stylistic
// preference.
//
// What deliberately STAYS:
//
//   * the wordmark. A payment page with no branding on it looks like a phishing
//     page, and "am I still on the right site" is the last thing someone should
//     be wondering while entering a card;
//   * one exit, so leaving is a decision rather than a trapped feeling;
//   * TeamProvider, because a plan is bought BY a team and every panel here reads
//     the active one.
//
// Admission is AuthGuard, shared with the app layout — the same session rules,
// deliberately not a second copy of them.
export default function PurchaseLayout({ children }: { children: React.ReactNode }) {
    return (
        <AuthGuard fallback={<PurchaseSkeleton />}>
            <TeamProvider>
                <div className="min-h-dvh bg-[color:var(--c-shell)]">
                    <header className="border-b border-[color:var(--c-border)]">
                        <div className="mx-auto flex h-14 w-full max-w-[1180px] items-center justify-between gap-4 px-5">
                            <span className="text-[14px] font-extrabold tracking-[-0.01em]">Ucelot</span>
                            <Link
                                href="/settings/billing"
                                className="text-[12.5px] font-semibold text-[color:var(--c-text-muted)] transition-colors hover:text-[color:var(--c-text)]"
                            >
                                Close
                            </Link>
                        </div>
                    </header>
                    <main className="mx-auto w-full max-w-[1180px] px-5 py-10 sm:py-14">{children}</main>
                </div>
            </TeamProvider>
        </AuthGuard>
    )
}

/** The header, with the content blanked — not an approximation of it. Keeping the
 *  wordmark and the frame while the session resolves avoids the page assembling
 *  itself around the reader on the one screen where flicker reads as broken. */
function PurchaseSkeleton() {
    return (
        <div className="min-h-dvh bg-[color:var(--c-shell)]">
            <header className="border-b border-[color:var(--c-border)]">
                <div className="mx-auto flex h-14 w-full max-w-[1180px] items-center px-5">
                    <span className="text-[14px] font-extrabold tracking-[-0.01em]">Ucelot</span>
                </div>
            </header>
            <main className="mx-auto w-full max-w-[1180px] px-5 py-10">
                <div className="h-64 animate-pulse rounded-[16px] bg-[color:var(--c-surface-2)]" />
            </main>
        </div>
    )
}
