import { GroupSettingsSkeleton } from "@/components/group-settings-skeleton"

// Route-level loading. Fires on hard navigations (initial visit,
// reload). Soft tab switches inside the group hit the Suspense
// boundary in page.tsx, which uses the same skeleton so the
// experience is identical either way.
export default function GroupSettingsLoading() {
    return <GroupSettingsSkeleton />
}
