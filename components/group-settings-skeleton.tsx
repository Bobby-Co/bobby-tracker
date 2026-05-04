// Skeleton for the group Settings tab. Mirrors GroupManagePanel's
// three-card stack (members / details / delete strip) so the user
// sees the page's shape even before data lands.
export function GroupSettingsSkeleton() {
    return (
        <div aria-busy className="flex flex-col gap-4">
            {/* Members card */}
            <div className="rounded-[16px] border border-[color:var(--c-border)] bg-white p-4 sm:p-5">
                <div className="skeleton h-4 w-44" />
                <div className="skeleton mt-2 h-3 w-3/4" />
                <div className="mt-3 flex flex-wrap gap-2">
                    {[0, 1, 2, 3].map((i) => (
                        <div key={i} className="skeleton h-7 w-28 rounded-full" />
                    ))}
                </div>
                <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                    <div className="skeleton h-10 w-full rounded-[12px] sm:max-w-xs" />
                    <div className="skeleton h-10 w-full rounded-[12px] sm:w-24" />
                </div>
            </div>

            {/* Details card */}
            <div className="rounded-[16px] border border-[color:var(--c-border)] bg-white p-4 sm:p-5">
                <div className="skeleton h-4 w-20" />
                <div className="mt-3 flex flex-col gap-3">
                    <div className="flex flex-col gap-1">
                        <div className="skeleton h-2.5 w-12" />
                        <div className="skeleton h-9 w-full rounded-[12px]" />
                    </div>
                    <div className="flex flex-col gap-1">
                        <div className="skeleton h-2.5 w-24" />
                        <div className="skeleton h-20 w-full rounded-[12px]" />
                    </div>
                </div>
                <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
                    <div className="skeleton h-8 w-28 rounded-[10px]" />
                    <div className="skeleton h-8 w-28 rounded-[10px]" />
                </div>
            </div>
        </div>
    )
}
