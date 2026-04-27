import Link from "next/link"
import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"

export default async function Home() {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (user) redirect("/projects")

    return (
        <div className="flex min-h-screen flex-col items-center justify-center bg-zinc-50 px-6 dark:bg-black">
            <div className="w-full max-w-md text-center">
                <h1 className="text-3xl font-semibold tracking-tight">Bobby Tracker</h1>
                <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">
                    Smart issue tracker for your Bobby projects. Indexes your codebase so issues come with the files and lines worth investigating.
                </p>
                <Link
                    href="/login"
                    className="mt-6 inline-flex items-center justify-center rounded-lg bg-zinc-900 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-zinc-700 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
                >
                    Sign in
                </Link>
            </div>
        </div>
    )
}
