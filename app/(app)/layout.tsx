import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { Sidebar } from "@/components/sidebar"
import { MobileSidebar } from "@/components/mobile-sidebar"
import { SignOutButton } from "@/components/sign-out-button"
import type { Project } from "@/lib/supabase/types"

export default async function AppLayout({ children }: { children: React.ReactNode }) {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) redirect("/login")

    const { data: projects } = await supabase
        .from("projects")
        .select("*")
        .order("updated_at", { ascending: false })
        .returns<Project[]>()

    return (
        <div className="flex h-screen w-full bg-[color:var(--c-page)] text-[color:var(--c-text)]">
            <Sidebar projects={projects ?? []} />
            <div className="flex min-w-0 flex-1 flex-col">
                <header className="flex h-14 items-center justify-between gap-3 border-b border-[color:var(--c-border)] bg-white px-3 sm:px-5">
                    <div className="flex min-w-0 items-center gap-2">
                        <MobileSidebar projects={projects ?? []} />
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
