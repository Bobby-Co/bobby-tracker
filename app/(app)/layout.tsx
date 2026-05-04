import { Suspense, cache } from "react"
import { redirect } from "next/navigation"
import { createClient, getCurrentUser } from "@/lib/supabase/server"
import { Sidebar } from "@/components/sidebar"
import { MobileSidebar } from "@/components/mobile-sidebar"
import { SignOutButton } from "@/components/sign-out-button"
import type { Project } from "@/lib/supabase/types"

// Per-request memoised projects-list fetch. Both sidebars need it,
// and they're rendered inside independent Suspense boundaries — the
// cache() wrapper keeps it a single round-trip instead of two.
const getSidebarProjects = cache(async () => {
    const supabase = await createClient()
    const { data } = await supabase
        .from("projects")
        .select("id,name,updated_at")
        .order("updated_at", { ascending: false })
        .returns<Pick<Project, "id" | "name" | "updated_at">[]>()
    return (data ?? []) as Project[]
})

// Auth-gated app shell. The sidebar's project list is fetched inside
// a Suspense boundary so it doesn't block the page from streaming —
// children start rendering as soon as the auth check resolves, and
// the sidebar pops in when its query returns.
export default async function AppLayout({ children }: { children: React.ReactNode }) {
    const user = await getCurrentUser()
    if (!user) redirect("/login")

    return (
        <div className="flex h-screen w-full bg-[color:var(--c-page)] text-[color:var(--c-text)]">
            <Suspense fallback={<SidebarSkeleton />}>
                <SidebarSlot />
            </Suspense>
            <div className="flex min-w-0 flex-1 flex-col">
                <header className="flex h-14 items-center justify-between gap-3 border-b border-[color:var(--c-border)] bg-white px-3 sm:px-5">
                    <div className="flex min-w-0 items-center gap-2">
                        <Suspense fallback={null}>
                            <MobileSidebarSlot />
                        </Suspense>
                        <span className="text-[10.5px] font-bold uppercase tracking-[0.18em] text-[color:var(--c-text-muted)]">
                            Bobby
                        </span>
                        <span className="text-[10.5px] font-bold uppercase tracking-[0.18em] text-[color:var(--c-text-dim)]">
                            ·
                        </span>
                        <span className="text-[10.5px] font-bold uppercase tracking-[0.18em] text-[color:var(--c-text-muted)]">
                            Tracker
                        </span>
                    </div>
                    <SignOutButton email={user.email} />
                </header>
                <main className="dotted-bg flex-1 overflow-auto">{children}</main>
            </div>
        </div>
    )
}

// Pulled into a sub-component so React can suspend on its data fetch
// independently of the layout shell + children. Without this the
// `select * from projects` round-trip blocks the entire subtree.
async function SidebarSlot() {
    return <Sidebar projects={await getSidebarProjects()} />
}

async function MobileSidebarSlot() {
    return <MobileSidebar projects={await getSidebarProjects()} />
}

function SidebarSkeleton() {
    return (
        <aside
            aria-busy
            className="hidden w-60 shrink-0 flex-col gap-2 border-r border-[color:var(--c-border)] bg-white px-3 py-4 sm:flex"
        >
            <div className="skeleton h-3 w-24" />
            <div className="mt-3 flex flex-col gap-1.5">
                {[0, 1, 2, 3].map((i) => (
                    <div key={i} className="skeleton h-7 w-full rounded-[10px]" />
                ))}
            </div>
        </aside>
    )
}
