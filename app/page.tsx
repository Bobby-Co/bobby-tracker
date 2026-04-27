import Link from "next/link"
import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"

export default async function Home() {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (user) redirect("/projects")

    return (
        <div className="dotted-bg flex min-h-screen flex-col items-center justify-center px-6">
            <div className="flex w-full max-w-md flex-col items-center text-center">
                <span
                    aria-hidden
                    className="mb-6 grid h-12 w-12 place-items-center rounded-[14px] bg-zinc-900"
                    style={{ color: "#a3e635" }}
                >
                    <svg viewBox="0 0 106 102" width="28" height="28" fill="none">
                        <path d="M14 22 C14 12 22 4 32 4 H74 C84 4 92 12 92 22 V70 C92 86 80 98 64 98 H42 C26 98 14 86 14 70 Z" fill="currentColor" />
                        <circle cx="40" cy="46" r="9" fill="#080808" />
                        <circle cx="68" cy="46" r="9" fill="#080808" />
                    </svg>
                </span>
                <h1 className="text-[34px] font-extrabold leading-tight tracking-[-0.02em]">
                    Bobby Tracker
                </h1>
                <p className="mt-3 text-[15px] leading-6 text-[color:var(--c-text-muted)]">
                    Smart issue tracker for your Bobby projects.<br />
                    Issues come with the files and lines worth investigating.
                </p>
                <Link href="/login" className="btn-primary mt-7 px-6 py-2.5 text-[14px]">
                    Sign in
                </Link>
            </div>
        </div>
    )
}
