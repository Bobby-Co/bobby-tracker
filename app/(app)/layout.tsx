import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { Sidebar } from "@/components/sidebar"
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
        <div className="flex h-screen w-full bg-white text-zinc-900 dark:bg-black dark:text-zinc-50">
            <Sidebar projects={projects ?? []} />
            <div className="flex min-w-0 flex-1 flex-col">
                <header className="flex h-12 items-center justify-between border-b border-zinc-200 px-4 dark:border-zinc-800">
                    <span className="text-sm font-semibold tracking-tight">Bobby Tracker</span>
                    <SignOutButton email={user.email} />
                </header>
                <main className="flex-1 overflow-auto">{children}</main>
            </div>
        </div>
    )
}
