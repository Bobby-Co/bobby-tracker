import { redirect } from "next/navigation"

// Moved to /billing/plans (its own flow shell, outside the settings tabs).
// Kept as a redirect because this path has been linked from the billing panel
// and may be bookmarked.
export default function MovedPlansPage() {
    redirect("/billing/plans")
}
