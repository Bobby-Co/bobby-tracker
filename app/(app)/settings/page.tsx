import { redirect } from "next/navigation"

// /settings has no landing of its own yet — send it to the first (and, for now,
// only) section. As more settings sections land, this becomes a real overview.
export default function SettingsPage() {
    redirect("/settings/connections")
}
