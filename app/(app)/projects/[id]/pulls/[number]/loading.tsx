// Instant skeleton for the PR-detail page, shown while page.tsx fetches the
// consolidated PR view.
export default function Loading() {
    return (
        <div className="flex flex-col gap-4 px-4">
            <div className="skeleton h-3.5 w-28" />
            <div className="skeleton h-40 w-full rounded-[16px]" />
            <div className="skeleton h-48 w-full rounded-[16px]" />
            <div className="skeleton h-32 w-full rounded-[16px]" />
        </div>
    )
}
