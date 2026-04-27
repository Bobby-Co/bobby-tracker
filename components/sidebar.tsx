"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { cn } from "@/components/cn"
import type { Project } from "@/lib/supabase/types"

export function Sidebar({ projects, activeProjectId }: { projects: Project[]; activeProjectId?: string }) {
    const pathname = usePathname()
    const isInbox = pathname === "/projects"

    return (
        <nav className="flex h-full w-60 shrink-0 flex-col gap-1 border-r border-[color:var(--c-border)] bg-white px-3 py-4">
            <div className="mb-4 flex items-center gap-1 px-3">
                <BobbyMark />
                <span className="text-[15px] font-bold tracking-[-0.01em]">Tracker</span>
            </div>

            <Link
                href="/projects"
                className={cn(
                    "flex items-center justify-between rounded-[10px] px-3 py-1.5 text-sm font-medium transition-colors",
                    isInbox
                        ? "bg-zinc-100 text-zinc-900"
                        : "text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900",
                )}
            >
                <span className="inline-flex items-center gap-2">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                        <rect x="3" y="3" width="18" height="18" rx="3" />
                        <path d="M3 9h18M9 21V9" />
                    </svg>
                    Projects
                </span>
                <span className="text-[11px] tabular-nums text-[color:var(--c-text-dim)]">{projects.length}</span>
            </Link>

            <div className="mt-4 px-3 text-[10.5px] font-bold uppercase tracking-[0.12em] text-[color:var(--c-text-dim)]">
                Your projects
            </div>
            <div className="mt-1 flex flex-col gap-0.5">
                {projects.length === 0 && (
                    <p className="px-3 py-2 text-xs text-[color:var(--c-text-dim)]">No projects yet.</p>
                )}
                {projects.map((p) => {
                    const active = p.id === activeProjectId
                    return (
                        <Link
                            key={p.id}
                            href={`/projects/${p.id}/issues`}
                            className={cn(
                                "group flex items-center gap-2 truncate rounded-[10px] px-3 py-1.5 text-[13px] transition-colors",
                                active
                                    ? "bg-zinc-100 text-zinc-900 font-semibold"
                                    : "text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900",
                            )}
                        >
                            <span
                                className={cn(
                                    "h-1.5 w-1.5 rounded-full transition-colors",
                                    active ? "bg-zinc-900" : "bg-zinc-300 group-hover:bg-zinc-500",
                                )}
                            />
                            <span className="truncate">{p.name}</span>
                        </Link>
                    )
                })}
            </div>
        </nav>
    )
}

const BobbyMark = () => (
  <svg width={20} height={20} viewBox="0 0 106 102" xmlns="http://www.w3.org/2000/svg">
    <path
      fill="black"
      d="M 95.59375 67.023438 L 95.609375 17.179688 C 95.610001 12.229996 91.550003 8.239998 86.589996 8.339996 C 81.720001 8.43 77.919998 12.610001 77.919998 17.470001 L 77.921875 32.132813 C 77.919998 36.360001 74.559998 39.91 70.330002 39.950001 L 68.539063 39.84375 C 64.690002 39.32 61.84 35.979996 61.84 32.089996 L 61.84375 18.078125 C 61.84 14.139999 59.560001 10.470001 55.919998 8.959999 C 52.259998 7.440002 49.66 9.010002 47.189999 10.520004 C 44.529999 12.129997 36.509998 16.379997 36.509998 16.379997 L 36.03125 16.640625 L 35.546875 16.382813 C 35.549999 16.379997 27.440001 12.099998 25.32 10.770004 C 22.82 9.199997 20.280001 7.440002 16.540001 8.870003 C 12.78 10.309998 10.39 14.050003 10.39 18.089996 L 10.390625 67.023438 C 10.84 79.970001 21.459999 90.339996 34.509998 90.339996 L 71.492188 90.34375 C 84.540001 90.339996 95.160004 79.970001 95.59375 67.023438 Z M 23.25 40.460938 C 21.219999 39.689999 19.780001 37.729996 19.780001 35.419998 C 19.780001 33.110001 21.219999 31.150002 23.25 30.370003 C 23.860001 30.129997 24.52 30 25.200001 30 C 26.26 30 27.24 30.309998 28.08 30.839996 C 29.6 31.800003 30.610001 33.490005 30.610001 35.419998 C 30.610001 37.349998 29.6 39.049999 28.08 40 C 27.24 40.529999 26.26 40.830002 25.200001 40.830002 C 24.52 40.830002 23.860001 40.700001 23.25 40.460938 Z M 44.15625 39.609375 C 42.939999 38.619999 42.169998 37.110001 42.169998 35.419998 C 42.169998 33.729996 42.939999 32.220001 44.16 31.229996 C 45.09 30.459999 46.279999 30 47.580002 30 C 49.07 30 50.41 30.599998 51.389999 31.57 C 52.389999 32.559998 53 33.919998 53 35.419998 C 53 36.93 52.389999 38.279999 51.389999 39.259998 C 50.41 40.240002 49.07 40.830002 47.580002 40.830002 C 46.279999 40.830002 45.09 40.369999 44.15625 39.609375 Z M 34.507813 81.492188 C 26.360001 81.489998 19.68 75.07 19.26 67.019997 L 29.6875 67.023438 L 29.6875 60.148438 C 29.690001 58.169998 31.290001 56.57 33.27 56.57 L 42.1875 56.570313 C 44.169998 56.57 45.77 58.169998 45.77 60.150002 L 45.773438 67.023438 L 58.632813 67.023438 L 58.632813 60.148438 C 58.630001 58.169998 60.23 56.57 62.209999 56.57 L 71.132813 56.570313 C 73.110001 56.57 74.709999 58.169998 74.709999 60.150002 L 74.710938 67.023438 L 86.742188 67.023438 C 86.32 75.07 79.639999 81.489998 71.489998 81.489998 Z"
    />
  </svg>
)
